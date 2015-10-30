import Client from 'bittorrent-tracker';
import parseTorrent from 'parse-torrent';
import fs from 'fs';
import wrtc from 'wrtc';

const torrent = fs.readFileSync(__dirname + '/blockai-logo.png.torrent');
const parsedTorrent = parseTorrent(torrent); // { infoHash: 'xxx', length: xx, announce: ['xx', 'xx'] }

console.log(parsedTorrent);

const peerId = new Buffer('01234567890123456789');
const port = 6881;

const opts = {
  wrtc,
};

const client = new Client(peerId, port, parsedTorrent, opts);

client.on('error', (err) => {
  // fatal client error!
  console.log(err.message);
});

client.on('warning', (err) => {
  // a tracker was unavailable or sent bad data to the client. you can probably ignore it
  console.log(err.message);
});

// start getting peers from the tracker
client.start();

client.on('update', (data) => {
  console.log('got an announce response from tracker: ' + data.announce);
  console.log('number of seeders in the swarm: ' + data.complete);
  console.log('number of leechers in the swarm: ' + data.incomplete);
});

client.once('peer', (addr) => {
  console.log('found a peer: ' + addr); // 85.10.239.191:48623
});

// announce that download has completed (and you are now a seeder)
// client.complete();

// force a tracker announce. will trigger more 'update' events and maybe more 'peer' events
// client.update();

// stop getting peers from the tracker, gracefully leave the swarm
// client.stop();

// ungracefully leave the swarm (without sending final 'stop' message)
// client.destroy();

// scrape
client.scrape();

client.on('scrape', (data) => {
  console.log('got a scrape response from tracker: ' + data.announce);
  console.log('number of seeders in the swarm: ' + data.complete);
  console.log('number of leechers in the swarm: ' + data.incomplete);
  console.log('number of total downloads of this torrent: ' + data.incomplete);
});
