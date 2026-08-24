#!/usr/bin/env bash

set -euo pipefail

echo "Installing prerequisites..."

brew install python uv git

echo "Creating virtual environment..."

uv venv ~/.venvs/mlx

source ~/.venvs/mlx/bin/activate

echo "Installing mlx-lm..."

uv pip install -U mlx-lm

echo ""
echo "Installation completed."
echo ""
echo "Activate environment:"
echo "source ~/.venvs/mlx/bin/activate"
echo ""
echo "Verify:"
echo "mlx_lm --help"