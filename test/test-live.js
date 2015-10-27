import test from 'tape';
import HTTPBridge from '../src';
import WebTorrent from 'webtorrent';
import auto from 'run-auto';
import finalhandler from 'finalhandler';
import fs from 'fs';
import http from 'http';
import parseTorrent from 'parse-torrent';
import path from 'path';
import serveStatic from 'serve-static';

const testtxtPath = path.resolve(__dirname, 'static', 'test.txt');
const testtxtFilename = 'test.txt';
const testtxtFile = fs.readFileSync(testtxtPath);
const testtxtTorrent = fs.readFileSync(path.resolve(__dirname, 'torrents', 'test.txt.torrent'));
const testtxtParsed = parseTorrent(testtxtTorrent);

test.d('Seed file and download', (t) => {
  t.plan(9);

  let httpServer;
  let bridge;
  let client;

  auto({
    httpPort: (cb) => {
      const serve = serveStatic(path.join(__dirname, 'static'));
      httpServer = http.createServer((req, res) => {
        const done = finalhandler(req, res);
        serve(req, res, done);
      });
      httpServer.on('error', (err) => { t.fail(err); });
      httpServer.listen(() => {
        const port = httpServer.address().port;
        cb(null, port);
      });
    },
    bridge: ['httpPort', (cb, r) => {
      bridge = new HTTPBridge();
      const url = 'http://127.0.0.1:' + r.httpPort + '/' + testtxtFilename;
      t.comment(url);
      bridge.seed(url, testtxtParsed, (err) => {
        t.error(err);
        // cb();
      });
    }],
    client: ['bridge', (cb) => {
      t.comment('client download');
      client = new WebTorrent({ torrentPort: 1337 });
      client.on('error', t.fail.bind(t));
      client.on('warning', t.fail.bind(t));

      const magnetUri = 'magnet:?xt=urn:btih:' + testtxtParsed.infoHash;

      t.comment(magnetUri);

      let gotBuffer = false;
      let gotDone = false;
      const maybeDone = () => {
        if (gotBuffer && gotDone) cb(null, client);
      };

      client.add(magnetUri, (torrent) => {
        t.comment('got metadata');

        t.equal(torrent.name, testtxtParsed.name);

        torrent.files[0].getBuffer((err, buf) => {
          t.error(err);
          t.deepEqual(buf, testtxtFile, 'downloaded correct content');
          gotBuffer = true;
          maybeDone();
        });

        torrent.once('done', () => {
          t.pass('client2 downloaded torrent from bridge');
          gotDone = true;
          maybeDone();
        });
      });
    }],
  }, (err) => {
    t.error(err);
    httpServer.close(() => { t.pass('httpServer destroyed'); });
    bridge.destroy(() => { t.pass('bridge destroyed'); });
    client.destroy(() => { t.pass('client destroyed'); });
  });
});
