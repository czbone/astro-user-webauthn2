#!/bin/sh
port="${PORT:-3000}"
curl -sf -o /dev/null "http://127.0.0.1:${port}/" || exit 1
