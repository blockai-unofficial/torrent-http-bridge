#!/bin/bash

babel-node ./src/cli/dht.js &
babel-node ./src/cli/http &
babel-node ./src/cli/seed.js http://localhost:6000/test.txt ./test/torrents/test.txt.torrent &

babel-node ./src/cli/download.js dd82c0927c74bb957a5dc1e352fffc8419535037

# kill backgrounded jobs
kill -TERM -- -$$
