#!/bin/sh
# Thư mục ./data gắn từ máy chủ thường thuộc root: trao quyền cho user "node" rồi chạy ứng dụng bằng user đó.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  chown -R node:node "${DATA_DIR:-/data}"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
