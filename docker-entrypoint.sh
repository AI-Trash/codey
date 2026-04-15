#!/bin/sh

set -eu

if [ ! -d /app/.output/public ] && [ -f /app/.output/public.tar.gz ]; then
  tar -xzf /app/.output/public.tar.gz -C /app/.output
fi

exec "$@"
