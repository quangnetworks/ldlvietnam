#!/bin/sh
# Chạy LDL Workspace (Linux / macOS). Cần Node.js >= 22.5. Cấu hình trong tệp .env cạnh tệp này.
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.example .env; echo "Đã tạo .env từ .env.example — sửa ADMIN_PASSWORD nếu cần."; }
export DATA_DIR="${DATA_DIR:-$(pwd)/data}"
exec node --no-warnings=ExperimentalWarning server/src/node.js
