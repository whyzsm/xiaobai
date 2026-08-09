#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
XIAOBAI_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_DISPLAY_NAME='tiny白'
PACKAGE_ARCHIVE=''
OUTPUT_ROOT="$XIAOBAI_ROOT/dist"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --package)
      PACKAGE_ARCHIVE="${2:?missing path after --package}"
      shift 2
      ;;
    --output)
      OUTPUT_ROOT="${2:?missing path after --output}"
      shift 2
      ;;
    --help)
      printf 'usage: %s --package /path/to/xiaobai-openhands-<commit>.tar.gz [--output /path/to/dist]\n' "$0"
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$PACKAGE_ARCHIVE" ]; then
  printf 'missing required --package archive\n' >&2
  exit 2
fi
if [ ! -f "$PACKAGE_ARCHIVE" ]; then
  printf 'package archive does not exist: %s\n' "$PACKAGE_ARCHIVE" >&2
  exit 1
fi

PACKAGE_ARCHIVE="$(cd "$(dirname "$PACKAGE_ARCHIVE")" && pwd)/$(basename "$PACKAGE_ARCHIVE")"
APP_ICON_SOURCE="$SCRIPT_DIR/macos/TinyBai.png"
APP_ICON_NAME='TinyBai.icns'
PACKAGE_NAME="$(/usr/bin/tar -tzf "$PACKAGE_ARCHIVE" | /usr/bin/awk -F/ 'NR == 1 { print $1 }')"
if [[ ! "$PACKAGE_NAME" =~ ^xiaobai-openhands-[0-9a-f]{12}$ ]]; then
  printf 'unexpected package root: %s\n' "$PACKAGE_NAME" >&2
  exit 1
fi
if [ ! -f "$APP_ICON_SOURCE" ]; then
  printf 'missing app icon source: %s\n' "$APP_ICON_SOURCE" >&2
  exit 1
fi
if ! /usr/bin/tar -tzf "$PACKAGE_ARCHIVE" | /usr/bin/awk -v root="$PACKAGE_NAME/" '
  /^\// || /(^|\/)\.\.(\/|$)/ || index($0, root) != 1 { invalid = 1 }
  END { exit invalid }
'; then
  printf 'package archive contains an unsafe or unexpected path\n' >&2
  exit 1
fi
for required in \
  "$PACKAGE_NAME/SHA256SUMS" \
  "$PACKAGE_NAME/artifacts/xiaobai.bundle" \
  "$PACKAGE_NAME/artifacts/xiaoneng.bundle" \
  "$PACKAGE_NAME/artifacts/openhands.bundle" \
  "$PACKAGE_NAME/deploy/openhands/run.sh" \
  "$PACKAGE_NAME/deploy/openhands/stop.sh" \
  "$PACKAGE_NAME/deploy/openhands/vault-path.sh" \
  "$PACKAGE_NAME/deploy/openhands/.env.example"; do
  if ! /usr/bin/tar -tzf "$PACKAGE_ARCHIVE" | /usr/bin/grep -qx "$required"; then
    printf 'package archive is missing: %s\n' "$required" >&2
    exit 1
  fi
done

OUTPUT_ROOT="$(mkdir -p "$OUTPUT_ROOT" && cd "$OUTPUT_ROOT" && pwd)"
FINAL_APP="$OUTPUT_ROOT/$APP_DISPLAY_NAME.app"
FINAL_ZIP="$OUTPUT_ROOT/${PACKAGE_NAME}-macOS.zip"
if [ -e "$FINAL_APP" ] || [ -e "$FINAL_ZIP" ]; then
  printf 'application output already exists; move it before rebuilding:\n%s\n%s\n' "$FINAL_APP" "$FINAL_ZIP" >&2
  exit 1
fi

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/xiaobai-openhands-app.XXXXXX")"
cleanup() {
  if [ -d "$TEMP_ROOT" ]; then
    rm -r -- "$TEMP_ROOT"
  fi
}
trap cleanup EXIT INT TERM

compile_native_launcher() {
  local swift_source="$1"
  local output="$2"
  local native_arch
  local arch
  local arch_output
  local compiled_outputs=()
  local compiled_arches=()

  if ! xcrun --find swiftc >/dev/null 2>&1; then
    printf 'Swift compiler is required to build the native macOS window. Install Xcode Command Line Tools and retry.\n' >&2
    exit 1
  fi
  native_arch="$(/usr/bin/uname -m)"

  for arch in arm64 x86_64; do
    arch_output="$TEMP_ROOT/XiaobaiOpenHands-$arch"
    if xcrun swiftc \
      -target "$arch-apple-macos13.0" \
      -o "$arch_output" \
      "$swift_source" \
      -framework Cocoa \
      -framework WebKit \
      2>"$TEMP_ROOT/swiftc-$arch.log"; then
      compiled_outputs+=("$arch_output")
      compiled_arches+=("$arch")
    elif [ "$arch" = "$native_arch" ]; then
      printf 'failed to compile native macOS launcher for %s:\n' "$arch" >&2
      sed -n '1,160p' "$TEMP_ROOT/swiftc-$arch.log" >&2
      exit 1
    fi
  done

  if [ "${#compiled_outputs[@]}" -eq 0 ]; then
    printf 'failed to compile native macOS launcher\n' >&2
    exit 1
  fi

  if [ "${#compiled_outputs[@]}" -gt 1 ] && command -v lipo >/dev/null 2>&1; then
    /usr/bin/lipo -create -output "$output" "${compiled_outputs[@]}"
    printf 'native launcher: universal (%s)\n' "${compiled_arches[*]}"
  else
    cp "${compiled_outputs[0]}" "$output"
    printf 'native launcher: %s\n' "${compiled_arches[0]}"
  fi
  chmod 755 "$output"
}

create_app_icon() {
  local source_png="$1"
  local output_icns="$2"
  local iconset="$TEMP_ROOT/TinyBai.iconset"

  if ! command -v sips >/dev/null 2>&1 || ! command -v iconutil >/dev/null 2>&1; then
    printf 'sips and iconutil are required to build the macOS app icon.\n' >&2
    exit 1
  fi

  mkdir -p "$iconset"
  /usr/bin/sips -z 16 16 "$source_png" --out "$iconset/icon_16x16.png" >/dev/null
  /usr/bin/sips -z 32 32 "$source_png" --out "$iconset/icon_16x16@2x.png" >/dev/null
  /usr/bin/sips -z 32 32 "$source_png" --out "$iconset/icon_32x32.png" >/dev/null
  /usr/bin/sips -z 64 64 "$source_png" --out "$iconset/icon_32x32@2x.png" >/dev/null
  /usr/bin/sips -z 128 128 "$source_png" --out "$iconset/icon_128x128.png" >/dev/null
  /usr/bin/sips -z 256 256 "$source_png" --out "$iconset/icon_128x128@2x.png" >/dev/null
  /usr/bin/sips -z 256 256 "$source_png" --out "$iconset/icon_256x256.png" >/dev/null
  /usr/bin/sips -z 512 512 "$source_png" --out "$iconset/icon_256x256@2x.png" >/dev/null
  /usr/bin/sips -z 512 512 "$source_png" --out "$iconset/icon_512x512.png" >/dev/null
  /usr/bin/sips -z 1024 1024 "$source_png" --out "$iconset/icon_512x512@2x.png" >/dev/null
  /usr/bin/iconutil -c icns "$iconset" -o "$output_icns"
}

STAGED_APP="$TEMP_ROOT/$APP_DISPLAY_NAME.app"
CONTENTS_ROOT="$STAGED_APP/Contents"
MACOS_ROOT="$CONTENTS_ROOT/MacOS"
RESOURCE_ROOT="$CONTENTS_ROOT/Resources"
mkdir -p "$MACOS_ROOT" "$RESOURCE_ROOT"

install -m 755 "$SCRIPT_DIR/macos/launcher.sh" "$MACOS_ROOT/XiaobaiOpenHandsLauncher"
compile_native_launcher "$SCRIPT_DIR/macos/XiaobaiOpenHands.swift" "$MACOS_ROOT/XiaobaiOpenHands"
install -m 644 "$SCRIPT_DIR/macos/Info.plist" "$CONTENTS_ROOT/Info.plist"
create_app_icon "$APP_ICON_SOURCE" "$RESOURCE_ROOT/$APP_ICON_NAME"
install -m 644 "$PACKAGE_ARCHIVE" "$RESOURCE_ROOT/package.tar.gz"
printf '%s\n' "$PACKAGE_NAME" >"$RESOURCE_ROOT/package-name"
/usr/bin/shasum -a 256 "$PACKAGE_ARCHIVE" | /usr/bin/awk '{ print $1 }' >"$RESOURCE_ROOT/package.sha256"
cat >"$RESOURCE_ROOT/NOTICE.txt" <<'NOTICE'
tiny白 应用不包含模型 Key 或个人 Obsidian Vault。首次运行时，配置与运行数据保存在当前用户的 Library/Application Support/tiny白 中。
tiny白 does not contain model keys or a personal Obsidian vault. On first launch, configuration and runtime data are stored under the current user's Library/Application Support/tiny白 directory.
NOTICE

/usr/bin/plutil -lint "$CONTENTS_ROOT/Info.plist" >/dev/null
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$STAGED_APP" >/dev/null
  codesign --verify --deep --strict "$STAGED_APP"
fi

mv "$STAGED_APP" "$FINAL_APP"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$FINAL_APP" "$FINAL_ZIP"

printf 'application: %s\n' "$FINAL_APP"
printf 'archive: %s\n' "$FINAL_ZIP"
printf 'payload: %s\n' "$PACKAGE_NAME"
