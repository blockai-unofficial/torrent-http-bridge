import initDebug from 'debug';
const debug = initDebug('torrent-http-bridge:torrent');

import extend from 'xtend/mutable';
import parseTorrent from 'parse-torrent';
import { EventEmitter } from 'events';
import Swarm from 'bittorrent-swarm';
import Discovery from 'torrent-discovery';
import reemit from 're-emitter';
import Piece from 'torrent-piece';
import BitField from 'bitfield';
import addrToIPPort from 'addr-to-ip-port';
import ut_metadata from 'ut_metadata';
import ut_pex from 'ut_pex';
import randomIterate from 'random-iterate';
import parallel from 'run-parallel';
import HTTPChunkStore from './HTTPChunkStore';
import uniq from 'uniq';

const MAX_BLOCK_LENGTH = 128 * 1024;
const PIECE_TIMEOUT = 30000;
const CHOKE_TIMEOUT = 5000;
// const SPEED_THRESHOLD = 3 * Piece.BLOCK_LENGTH;

// const PIPELINE_MIN_DURATION = 0.5;
// const PIPELINE_MAX_DURATION = 1;

const RECHOKE_INTERVAL = 10000; // 10 seconds
const RECHOKE_OPTIMISTIC_DURATION = 2; // 30 seconds

/**
 * Returns a random integer in [0,high)
 */
function randomInt(high) {
  return Math.random() * high | 0;
}

export default class Torrent extends EventEmitter {
  constructor(url, parsedTorrent, client) {
    super();
    this.url = url;
    this.parsedTorrent = parsedTorrent;
    this.client = client;
    this._onParsedTorrent(parsedTorrent);
    this._Store = HTTPChunkStore;
    this._servers = []; // for cleanup
  }

  _onParsedTorrent(parsedTorrent) {
    if (this.destroyed) return null;

    this._processParsedTorrent(parsedTorrent);

    if (!this.infoHash) {
      return this._onError(new Error('Malformed torrent data: No info hash'));
    }

    // create swarm
    this.swarm = new Swarm(this.infoHash, this.client.peerId, {
      handshake: {
        dht: this.private ? false : !!this.client.dht,
      },
    });

    this.swarm.on('error', this._onError.bind(this));
    this.swarm.on('wire', this._onWire.bind(this));

    this.swarm.on('download', (downloaded) => {
      // this.client.downloadSpeed(downloaded); // update overall client stats
      debug('download... hmmm this should not happen');
      this.client.emit('download', downloaded);
      this.emit('download', downloaded);
    });

    this.swarm.on('upload', (uploaded) => {
      // this.client.uploadSpeed(uploaded); // update overall client stats
      debug('upload');
      this.client.emit('upload', uploaded);
      this.emit('upload', uploaded);
    });

    // listen for peers (note: in the browser, this is a no-op and callback is called on
    // next tick)
    this.swarm.listen(this.client.torrentPort, this._onSwarmListening.bind(this));
  }

  addPeer(peer) {
    const addPeer = () => {
      this.swarm.addPeer(peer);
      this.emit('peer', peer);
    };
    if (this.swarm) addPeer();
    else this.once('listening', addPeer);
    return true;
  }

  _processParsedTorrent(parsedTorrent) {
    if (global.WEBTORRENT_ANNOUNCE) {
      parsedTorrent.announce = parsedTorrent.announce.concat(global.WEBTORRENT_ANNOUNCE);
    }

    uniq(parsedTorrent.announce);

    extend(this, parsedTorrent);
    this.magnetURI = parseTorrent.toMagnetURI(parsedTorrent);
    this.torrentFile = parseTorrent.toTorrentFile(parsedTorrent);
  }

  _onError(err) {
    debug('torrent error: %s', err.message || err);
    this.emit('error', err);
    this.destroy();
  }

  _onWire(wire, addr) {
    debug('got wire (%s)', addr || 'Unknown');

    if (addr) {
      // Sometimes RTCPeerConnection.getStats() doesn't return an ip:port for peers
      const parts = addrToIPPort(addr);
      wire.remoteAddress = parts[0];
      wire.remotePort = parts[1];
    }

    // If peer supports DHT, send PORT message to report DHT listening port
    if (wire.peerExtensions.dht && this.client.dht && this.client.dht.listening) {
      // When peer sends PORT, add them to the routing table
      wire.on('port', (port) => {
        if (!wire.remoteAddress) {
          debug('ignoring port from peer with no address');
          return;
        }
        debug('port: %s (from %s)', port, wire.remoteAddress + ':' + wire.remotePort);
        this.client.dht.addNode(wire.remoteAddress + ':' + port);
      });

      wire.port(this.client.dht.address().port);
    }

    wire.on('timeout', () => {
      debug('wire timeout (%s)', addr);
      // TODO: this might be destroying wires too eagerly
      wire.destroy();
    });

    // Timeout for piece requests to this peer
    wire.setTimeout(PIECE_TIMEOUT, true);

    // Send KEEP-ALIVE (every 60s) so peers will not disconnect the wire
    wire.setKeepAlive(true);

    // use ut_metadata extension
    wire.use(ut_metadata(this.metadata));

    if (!this.metadata) {
      wire.ut_metadata.on('metadata', (metadata) => {
        debug('got metadata via ut_metadata');
        this._onMetadata(metadata);
      });
      wire.ut_metadata.fetch();
    }

    // use ut_pex extension if the torrent is not flagged as private
    if (typeof ut_pex === 'function' && !this.private) {
      wire.use(ut_pex());

      // wire.ut_pex.start() // TODO two-way communication
      wire.ut_pex.on('peer', (peer) => {
        debug('ut_pex: got peer: %s (from %s)', peer, addr);
        this.addPeer(peer);
      });

      wire.ut_pex.on('dropped', (peer) => {
        // the remote peer believes a given peer has been dropped from the swarm.
        // if we're not currently connected to it, then remove it from the swarm's queue.
        const peerObj = this.swarm._peers[peer];
        if (peerObj && !peerObj.connected) {
          debug('ut_pex: dropped peer: %s (from %s)', peer, addr);
          this.swarm.removePeer(peer);
        }
      });
    }

    // Hook to allow user-defined `bittorrent-protocol extensions
    // More info: https://github.com/feross/bittorrent-protocol#extension-api
    this.emit('wire', wire, addr);

    if (this.metadata) {
      this._onWireWithMetadata(wire);
    }
  }

  _onSwarmListening() {
    debug('swarm listening');
    if (this.destroyed) return;

    if (this.swarm.server) this.client.torrentPort = this.swarm.address().port;

    // begin discovering peers via the DHT and tracker servers
    const discoveryOpts = {
      announce: this.announce,
      dht: this.private
        ? false
        : this.client.dht,
      tracker: this.client.tracker,
      peerId: this.client.peerId,
      port: this.client.torrentPort,
      rtcConfig: this.client._rtcConfig,
      wrtc: this.client._wrtc,
    };
    this.discovery = new Discovery(discoveryOpts);
    this.discovery.on('error', this._onError.bind(this));
    this.discovery.setTorrent(this.infoHash);
    this.discovery.on('peer', this.addPeer.bind(this));

    // expose discovery events
    reemit(this.discovery, this, ['trackerAnnounce', 'dhtAnnounce', 'warning']);

    // if full metadata was included in initial torrent id, use it
    if (this.info) this._onMetadata(this);

    this.emit('listening', this.client.torrentPort);
  }

  _onMetadata() {
    if (this.metadata || this.destroyed) return;
    this.metadata = this.torrentFile;

    // update discovery module with full torrent metadata
    this.discovery.setTorrent(this);

    this.store = new this._Store(this.pieceLength, {
      file: this.files[0],
      url: this.url,
      length: this.length,
    });

    this._hashes = this.pieces;

    this.pieces = this.pieces.map((hash, idx) => {
      const pieceLength = (idx === this.pieces.length - 1)
        ? this.lastPieceLength
        : this.pieceLength;
      return new Piece(pieceLength);
    });

    this.bitfield = new BitField(this.pieces.length);

    this.swarm.wires.forEach((wire) => {
      // If we didn't have the metadata at the time ut_metadata was initialized for this
      // wire, we still want to make it available to the peer in case they request it.
      if (wire.ut_metadata) wire.ut_metadata.setMetadata(this.metadata);

      this._onWireWithMetadata(wire);
    });


    // debug('verifying existing torrent data');
    parallel(this.pieces.map((piece, index) => {
      return (cb) => {
        // In this implementation we always assume we have all pieces
        // debug('piece verified %s', index);
        this.pieces[index] = null;
        this.bitfield.set(index, true);
        cb();
      };
    }), (err) => {
      if (err) return this._onError(err);
      debug('done verifying');
      this._onStore();
    });

    this.emit('metadata');
  }

  _onStore() {
    if (this.destroyed) return;
    debug('on store');

    // start off selecting the entire torrent with low priority
    // dont need here... we are seeding
    // this.select(0, this.pieces.length - 1, false);

    this._rechokeIntervalId = setInterval(this._rechoke.bind(this), RECHOKE_INTERVAL);
    if (this._rechokeIntervalId.unref) this._rechokeIntervalId.unref();

    this.ready = true;
    this.emit('ready');
  }

  _rechoke() {
    const rechokeSort = (peerA, peerB) => {
      // Prefer higher download speed
      if (peerA.downloadSpeed !== peerB.downloadSpeed) {
        return peerB.downloadSpeed - peerA.downloadSpeed;
      }

      // Prefer higher upload speed
      if (peerA.uploadSpeed !== peerB.uploadSpeed) {
        return peerB.uploadSpeed - peerA.uploadSpeed;
      }

      // Prefer unchoked
      if (peerA.wire.amChoking !== peerB.wire.amChoking) {
        return peerA.wire.amChoking ? 1 : -1;
      }

      // Random order
      return peerA.salt - peerB.salt;
    };

    if (this._rechokeOptimisticTime > 0) this._rechokeOptimisticTime -= 1;
    else this._rechokeOptimisticWire = null;

    const peers = [];

    this.swarm.wires.forEach((wire) => {
      if (!wire.isSeeder && wire !== this._rechokeOptimisticWire) {
        peers.push({
          wire: wire,
          downloadSpeed: wire.downloadSpeed(),
          uploadSpeed: wire.uploadSpeed(),
          salt: Math.random(),
          isChoked: true,
        });
      }
    });

    peers.sort(rechokeSort);

    let unchokeInterested = 0;
    let i = 0;
    for (; i < peers.length && unchokeInterested < this._rechokeNumSlots; ++i) {
      peers[i].isChoked = false;
      if (peers[i].wire.peerInterested) unchokeInterested += 1;
    }

    // Optimistically unchoke a peer
    if (!this._rechokeOptimisticWire && i < peers.length && this._rechokeNumSlots) {
      const candidates = peers.slice(i).filter((peer) => { return peer.wire.peerInterested; });
      const optimistic = candidates[randomInt(candidates.length)];

      if (optimistic) {
        optimistic.isChoked = false;
        this._rechokeOptimisticWire = optimistic.wire;
        this._rechokeOptimisticTime = RECHOKE_OPTIMISTIC_DURATION;
      }
    }

    // Unchoke best peers
    peers.forEach((peer) => {
      if (peer.wire.amChoking !== peer.isChoked) {
        if (peer.isChoked) peer.wire.choke();
        else peer.wire.unchoke();
      }
    });
  }

  _onWireWithMetadata(wire) {
    debug('_onWireWithMetadata');
    let timeoutId = null;

    const onChokeTimeout = () => {
      if (this.destroyed || wire.destroyed) return;

      if (this.swarm.numQueued > 2 * (this.swarm.numConns - this.swarm.numPeers) &&
        wire.amInterested) {
        wire.destroy();
      } else {
        timeoutId = setTimeout(onChokeTimeout, CHOKE_TIMEOUT);
        if (timeoutId.unref) timeoutId.unref();
      }
    };

    let idx = 0;
    const updateSeedStatus = () => {
      if (wire.peerPieces.length !== this.pieces.length) return;
      for (; idx < this.pieces.length; ++idx) {
        if (!wire.peerPieces.get(idx)) return;
      }
      wire.isSeeder = true;
      wire.choke(); // always choke seeders
    };

    wire.on('bitfield', () => {
      debug('bitfield');
      updateSeedStatus();
      this._update();
    });

    wire.on('have', () => {
      debug('have');
      updateSeedStatus();
      this._update();
    });

    wire.once('interested', () => {
      debug('interested');
      wire.unchoke();
    });

    wire.on('close', () => {
      clearTimeout(timeoutId);
    });

    wire.on('choke', () => {
      debug('choke');
      clearTimeout(timeoutId);
      timeoutId = setTimeout(onChokeTimeout, CHOKE_TIMEOUT);
      if (timeoutId.unref) timeoutId.unref();
    });

    wire.on('unchoke', () => {
      debug('unchoke');
      clearTimeout(timeoutId);
      this._update();
    });

    wire.on('request', (index, offset, length, cb) => {
      debug('request');
      if (length > MAX_BLOCK_LENGTH) {
        // Per spec, disconnect from peers that request >128KB
        return wire.destroy();
      }
      if (this.pieces[index]) return null;
      this.store.get(index, { offset: offset, length: length }, cb);
    });

    wire.bitfield(this.bitfield); // always send bitfield (required)
    // wire.interested(); // always start out interested

    timeoutId = setTimeout(onChokeTimeout, CHOKE_TIMEOUT);
    if (timeoutId.unref) timeoutId.unref();

    wire.isSeeder = false;
    updateSeedStatus();
  }

  _update() {
    if (this.destroyed) return;
    // update wires in random order for better request distribution
    const ite = randomIterate(this.swarm.wires);
    let wire;
    while ((wire = ite())) {
      this._updateWire(wire);
    }
  }

  _updateWire(wire) {
    if (wire.peerChoking) return;
    // this is only needed for download?
  }

  destroy(cb) {
    if (this.destroyed) return;
    this.destroyed = true;
    debug('destroy');

    // this.client.remove(this);

    if (this._rechokeIntervalId) {
      clearInterval(this._rechokeIntervalId);
      this._rechokeIntervalId = null;
    }

    const tasks = [];

    this._servers.forEach((server) => {
      tasks.push((_cb) => { server.destroy(_cb); });
    });

    if (this.swarm) tasks.push((_cb) => { this.swarm.destroy(_cb); });
    if (this.discovery) tasks.push((_cb) => { this.discovery.stop(_cb); });
    if (this.store) tasks.push((_cb) => { this.store.close(_cb); });

    parallel(tasks, cb);
  }

}
