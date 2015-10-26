# torrent-http-bridge

Work in progress

## install

```bash
npm install --save torrent-http-bridge
```

## usage

```js
const bridge = new HTTPBridge();

bridge.on('ready', () => {
  console.log('torrent port', bridge.torrentPort);
  console.log('node id', bridge.nodeIdHex);
  console.log('peer id', bridge.peerIdHex);

  // url: url to seed
  // parsedTorrent: torrent of the file to seed
  // see parse-torrent module
  bridge.seed(url, parsedTorrent, (err, torrent) => {
    if (err) exit(err);
    console.log('seeding', parsedTorrent.infoHash);
    torrent.on('dhtAnnounce', () => {
      console.log('dhtAnnounce');
    });
  });
});
```

## test

```
npm test
```

```
./integration-test.sh
```
