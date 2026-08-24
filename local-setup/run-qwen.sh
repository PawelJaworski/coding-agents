#!/usr/bin/env bash

source ~/.venvs/mlx/bin/activate

mlx_lm server \
  --model mlx-community/Qwen3.6-35B-A3B-4bit \
  --host 127.0.0.1 \
  --port 1234 \
  --max-tokens 2048 \
  --prompt-cache-size 1 \
  --decode-concurrency 1 \
  --prompt-concurrency 1
