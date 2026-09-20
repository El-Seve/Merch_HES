#!/bin/bash
# Descarga el binario de rclone (https://rclone.org, MIT license, gratis) dentro de
# backend/bin/ para que el servidor lo use al subir/leer fotos de OneDrive.
# No requiere permisos de administrador: es un binario autocontenido.
set -e
DEST_DIR="$(dirname "$0")/../bin"
mkdir -p "$DEST_DIR"

if [ -f "$DEST_DIR/rclone" ]; then
  echo "rclone ya está descargado, se omite."
  exit 0
fi

echo "Descargando rclone..."
TMP=$(mktemp -d)
curl -sL https://downloads.rclone.org/rclone-current-linux-amd64.zip -o "$TMP/rclone.zip"
unzip -oq "$TMP/rclone.zip" -d "$TMP"
cp "$TMP"/rclone-*-linux-amd64/rclone "$DEST_DIR/rclone"
chmod +x "$DEST_DIR/rclone"
rm -rf "$TMP"
echo "rclone instalado en $DEST_DIR/rclone"
"$DEST_DIR/rclone" version
