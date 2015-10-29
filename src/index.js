import initDebug from 'debug';
const debug = initDebug('torrent-http-bridge');

import extend from 'xtend';
import DHT from 'bittorrent-dht';
import { EventEmitter } from 'events';
import hat from 'hat';
import pkg from '../package.json';
import zeroFill from 'zero-fill';
import Torrent from './Torrent';
import parallel from 'run-parallel';

const VERSION = pkg.version;

/**
 * BitTorrent client version string (used in peer ID).
 * Generated from package.json major and minor version. For example:
 *   '0.16.1' -> '0016'
 *   '1.2.5' -> '0102'
 */
const VERSION_STR = VERSION.match(/([0-9]+)/g).slice(0, 2).map(zeroFill(2)).join('');

export default class HTTPBridge extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.torrentPort = opts.torrentPort || 0;
    this.dhtPort = opts.dhtPort;
    this.torrents = [];
    this.tracker = opts.tracker !== undefined ? opts.tracker : true;

    this._wrtc = opts.wrtc || global.WRTC;

    if (opts.peerId === undefined) {
      this.peerId = new Buffer('-WW' + VERSION_STR + '-' + hat(48), 'utf8');
    } else if (typeof opts.peerId === 'string') {
      this.peerId = new Buffer(opts.peerId, 'hex');
    } else {
      this.peerId = opts.peerId;
    }

    this.peerIdHex = this.peerId.toString('hex');

    if (opts.nodeId === undefined) {
      this.nodeId = new Buffer(hat(160), 'hex');
    } else if (typeof opts.nodeId === 'string') {
      this.nodeId = new Buffer(opts.nodeId, 'hex');
    } else {
      this.nodeId = opts.nodeId;
    }

    this.nodeIdHex = this.nodeId.toString('hex');

    if (opts.dht !== false) {
      // use a single DHT instance for all torrents, so the routing table can be reused
      this.dht = new DHT(extend({ nodeId: this.nodeId }, opts.dht));
      this.dht.listen(this.dhtPort);
    }

    debug('new httpbridge (peerId %s, nodeId %s)', this.peerIdHex, this.nodeIdHex);

    const ready = () => {
      if (this.destroyed) return;
      this.ready = true;
      this.emit('ready');
    };

    if (this.dht) {
      this.dht.on('ready', ready);
    } else {
      process.nextTick(ready);
    }
  }

  getTorrent(infoHash) {
    for (let index = 0, len = this.torrents.length; index < len; index++) {
      const torrent = this.torrents[index];
      if (torrent.infoHash === infoHash) return torrent;
    }
  }

  seed(url, parsedTorrent, onseed = () => {}) {
    if (this.destroyed) throw new Error('client is destroyed');
    debug('seed', url, parsedTorrent.infoHash);
    const torrent = new Torrent(url, parsedTorrent, this);
    this.torrents.push(torrent);
    torrent.on('listening', () => {
      onseed(null, torrent);
    });
    return torrent;
  }

  remove(torrent, cb) {
    debug('remove');
    this.torrents.splice(this.torrents.indexOf(torrent), 1);
    torrent.destroy(cb);
  }

  destroy(cb) {
    if (this.destroyed) throw new Error('client already destroyed');
    this.destroyed = true;
    debug('destroy');

    const tasks = this.torrents.map((torrent) => {
      return (_cb) => { this.remove(torrent, _cb); };
    });

    if (this.dht) tasks.push((_cb) => { this.dht.destroy(_cb); });
    parallel(tasks, cb);
  }
}
