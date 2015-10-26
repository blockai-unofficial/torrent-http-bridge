import get from 'simple-get';
import initDebug from 'debug';
const debug = initDebug('torrent-http-bridge:chunkstore');

export default class HTTPChunkStore {
  constructor(pieceLength, opts) {
    this.pieceLength = pieceLength;
    this.file = opts.file;
    this.url = opts.url;
    debug('created chunk store for %s', this.url);
  }

  get(index, { offset, length }, cb) {
    return this._httpRequest(index, offset, length, cb);
  }

  // Taken from bittorrent-swarm webconn.js
  _httpRequest(pieceIndex, offset, length, cb) {
    const pieceOffset = pieceIndex * this.pieceLength;
    const start = pieceOffset + offset;
    const end = start + length - 1;

    debug('Requesting pieceIndex=%d offset=%d length=%d start=%d end=%d', pieceIndex, offset, length, start, end);

    const opts = {
      url: this.url,
      method: 'GET',
      headers: {
        'user-agent': 'WebTorrent-HTTP-Bridge (http://webtorrent.io)',
        'range': 'bytes=' + start + '-' + end,
      },
    };

    get.concat(opts, (err, data, res) => {
      if (err) return cb(err);
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return cb(new Error('Unexpected HTTP status code ' + res.statusCode));
      }
      debug('Got data of length %d', data.length);
      cb(null, data);
    });
  }

  close(cb) {
    process.nextTick(cb);
  }
}
