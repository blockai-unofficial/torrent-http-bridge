import DHT from 'bittorrent-dht';
import magnet from 'magnet-uri';

const infoHash = process.argv[2];
console.log(infoHash);

const uri = 'magnet:?xt=urn:btih:' + infoHash;
const parsed = magnet(uri);

const exit = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!parsed.infoHash) {
  exit('first argument must be infoHash');
}

console.log('infoHash:', parsed.infoHash);

const dht = new DHT({
  bootstrap: '127.0.0.1:20000',
});

dht.listen(20001, () => {
  console.log('now listening');
});

dht.on('ready', () => {
  console.log('ready');
  // DHT is ready to use (i.e. the routing table contains at least K nodes, discovered
  // via the bootstrap nodes)

  // find peers for the given torrent info hash
  // console.log(infoHashBuf);
  dht.lookup(infoHash, (err, res) => {
    if (err) exit(err);
    console.log('dht.lookup result:');
    console.log(res);
    const infoHashBuf = new Buffer(parsed.infoHash, 'hex');
    dht.get(infoHashBuf, (_err, _res) => {
      if (_err) exit(_err);
      console.log('dht.get result:');
      console.log(_res);
    });
  });
});

dht.on('peer', (addr, hash, from) => {
  console.log('found potential peer ' + addr + ' through ' + from);
});

