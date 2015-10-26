import DHT from 'bittorrent-dht';

const dht = new DHT({
  bootstrap: false,
});

dht.listen(20000, () => {
  console.log('dht now listening');
});

dht.on('ready', () => {
  console.log('dht ready');
});

dht.on('peer', (addr, hash, from) => {
  console.log('dht found potential peer ' + addr + ' through ' + from);
});

