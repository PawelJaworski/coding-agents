#!/usr/bin/env bash

set -euo pipefail

MODEL="mlx-community/Qwen3.6-35B-A3B-4bit"

source ~/.venvs/mlx/bin/activate

mlx_lm generate \
  --model "$MODEL" \
  --prompt "Write a Java Spring Boot REST controller for policy issuance."