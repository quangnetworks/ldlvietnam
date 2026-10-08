#!/bin/sh
# Sao lưu CSDL + tệp đính kèm (chạy được khi ứng dụng đang hoạt động). Đặt lịch: crontab -e
#   30 1 * * * /srv/ldl-workspace/backup.sh >> /srv/ldl-workspace/data/backups/backup.log 2>&1
cd "$(dirname "$0")"
export DATA_DIR="${DATA_DIR:-$(pwd)/data}"
exec node --no-warnings=ExperimentalWarning server/scripts/backup.mjs "$@"
