import WebTorrent from 'webtorrent';

const exit = (msg) => {
  console.error(msg);
  process.exit(1);
};

const infoHash = process.argv[2];

if (!infoHash) {
  exit('usage: ./download <infohash>');
}


const client = new WebTorrent({
  tracker: false,
  dht: { bootstrap: '127.0.0.1:20000' },
});
client.on('error', exit);
client.on('warning', exit);

const magnetUri = 'magnet:?xt=urn:btih:' + infoHash;

client.add(magnetUri, (torrent) => {
  console.log('got torrent metadata');
  console.log(torrent.infoHash);
  console.log(torrent.name);

  torrent.files[0].getBuffer((err, buf) => {
    if (err) exit(err);
    console.log(buf.toString('utf-8'));
    process.exit();
  });

  torrent.once('done', () => {
    console.log('done downloading');
  });
});
