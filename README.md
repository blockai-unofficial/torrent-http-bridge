# torrent-http-bridge

Work in progress.

Expose any URL over the bittorrent network.

[WebTorrent](https://github.com/feross/webtorrent) based server that
seeds files not located on the local filesystem but on remote URLs (the
remote HTTP server must support [byte
range](https://en.wikipedia.org/wiki/Byte_serving) requests).

The server, also known as a torrent to http "bridge", announces the
torrent's infohash on BitTorrent's
[DHT](https://en.wikipedia.org/wiki/Mainline_DHT) and whenever a peer
tries downloading a file it knows about, it respond to requests by
fetching parts of the remote URL using byte range requests and forward
those responses to the peer using the Bittorrent protocol.


```
                     +-------------------------+
                     |       http server       |
                     |                         |
                     | http://domain/file.webm |
                     +-^-----------------------+
                       |
                       |     (1) seed http://domain/file.webm
     (7) byte range    |         with torrent file file.torrent
         requests      |      +  and infohash XYZ
                       |      |
                     +-v------v-+                    +-----+
                     |  bridge  +--------------------> DHT |
                     +-^------^-+   (2) i have XYZ   +-----+
                       |      |                         ^  |
     (6) request file  |      |(5) torrent metadata     |  |
         pieces        |      |                         |  |
                     +-v------v-+     (3) who has XYZ   |  |
                     |   peer   +-----------------------+  |
                     +----------+                          |
                           ^-------------------------------+
                                   (4) bridge has XYZ
```

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
