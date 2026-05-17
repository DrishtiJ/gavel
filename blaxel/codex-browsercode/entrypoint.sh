#!/usr/bin/env bash
set -euo pipefail

/usr/local/bin/sandbox-api &

until nc -z 127.0.0.1 8080; do
  sleep 0.1
done

echo "Sandbox API ready"
wait
