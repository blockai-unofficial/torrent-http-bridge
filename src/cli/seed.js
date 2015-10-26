import HTTPBridge from '../';
import fs from 'fs';
import parseTorrent from 'parse-torrent';

const exit = (msg) => {
  console.error(msg);
  process.exit(1);
};
const url = process.argv[2];
const torrentPath = process.argv[3];

if (!fs.existsSync(torrentPath) || !url) {
  exit('usage: ./cli <url> <torrent path>');
}

const torrentFile = fs.readFileSync(torrentPath);
const parsedTorrent = parseTorrent(torrentFile);

const bridge = new HTTPBridge({
  dht: { bootstrap: '127.0.0.1:20000' },
});

bridge.on('ready', () => {
  console.log('torrent port', bridge.torrentPort);
  console.log('node id', bridge.nodeIdHex);
  console.log('peer id', bridge.peerIdHex);

  bridge.seed(url, parsedTorrent, (err, torrent) => {
    if (err) exit(err);

    console.log('seeding', parsedTorrent.infoHash);
    torrent.on('dhtAnnounce', () => {
      console.log('dhtAnnounce');
    });
  });
});
