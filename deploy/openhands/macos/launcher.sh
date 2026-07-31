#!/bin/bash
set -uo pipefail

umask 077

APP_NAME='tiny白'
APP_COMPOSE_PROJECT='xiaobai-openhands-app'
APP_DEFAULT_PORT='8001'
APP_DEFAULT_CONTROL_PLANE_PORT='18003'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTENTS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOURCE_ROOT="$CONTENTS_ROOT/Resources"
PACKAGE_ARCHIVE="$RESOURCE_ROOT/package.tar.gz"
PACKAGE_NAME_FILE="$RESOURCE_ROOT/package-name"
PACKAGE_CHECKSUM_FILE="$RESOURCE_ROOT/package.sha256"
SUPPORT_ROOT="${XIAOBAI_APP_SUPPORT_ROOT:-$HOME/Library/Application Support/tiny白}"
PACKAGES_ROOT="$SUPPORT_ROOT/packages"
CONFIG_ROOT="$SUPPORT_ROOT/config"
CONFIG_FILE="$CONFIG_ROOT/.env"
CONFIG_MIGRATION_MARKER="$CONFIG_ROOT/.launcher-defaults-v3"
LOG_ROOT="$SUPPORT_ROOT/logs"
LOG_FILE="$LOG_ROOT/launcher.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$PACKAGES_ROOT" "$CONFIG_ROOT" "$LOG_ROOT"
chmod 700 "$SUPPORT_ROOT" "$PACKAGES_ROOT" "$CONFIG_ROOT" "$LOG_ROOT" 2>/dev/null || true
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"

log_event() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >>"$LOG_FILE"
}

show_notification() {
  /usr/bin/osascript - "$1" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  display notification (item 1 of argv) with title "tiny白"
end run
APPLESCRIPT
}

show_message() {
  /usr/bin/osascript - "$1" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  display dialog (item 1 of argv) with title "tiny白" buttons {"知道了"} default button "知道了" with icon note
end run
APPLESCRIPT
}

show_error() {
  local message="$1"
  log_event "ERROR: $message"
  /usr/bin/osascript - "$message" "$LOG_FILE" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  set messageText to item 1 of argv
  set logPath to item 2 of argv
  set answer to display dialog messageText with title "tiny白" buttons {"关闭", "打开日志"} default button "打开日志" cancel button "关闭" with icon stop
  if button returned of answer is "打开日志" then
    do shell script "/usr/bin/open -a TextEdit " & quoted form of logPath
  end if
end run
APPLESCRIPT
}

fail_install() {
  local install_root="$1"
  local message="$2"
  if [ -d "$install_root" ]; then
    rm -r -- "$install_root"
  fi
  show_error "$message"
  return 1
}

ensure_payload() {
  if [ ! -f "$PACKAGE_ARCHIVE" ] || [ ! -f "$PACKAGE_NAME_FILE" ] || [ ! -f "$PACKAGE_CHECKSUM_FILE" ]; then
    show_error '应用资源不完整，请重新获取 tiny白 应用。'
    return 1
  fi

  PACKAGE_NAME="$(tr -d '\r\n' <"$PACKAGE_NAME_FILE")"
  if [[ ! "$PACKAGE_NAME" =~ ^xiaobai-openhands-[0-9a-f]{12}$ ]]; then
    show_error '应用内分发包名称无效，请重新获取应用。'
    return 1
  fi

  PACKAGE_ROOT="$PACKAGES_ROOT/$PACKAGE_NAME"
  RUN_SCRIPT="$PACKAGE_ROOT/deploy/openhands/run.sh"
  STOP_SCRIPT="$PACKAGE_ROOT/deploy/openhands/stop.sh"

  if [ -f "$PACKAGE_ROOT/.xiaobai-app-installed" ] && [ -x "$RUN_SCRIPT" ] && [ -x "$STOP_SCRIPT" ]; then
    return 0
  fi
  if [ -e "$PACKAGE_ROOT" ]; then
    show_error "发现未完成的应用数据：$PACKAGE_ROOT。请先备份后移除该目录，再重新打开应用。"
    return 1
  fi

  local expected_checksum
  local actual_checksum
  local install_root
  local extracted_root
  expected_checksum="$(tr -d '[:space:]' <"$PACKAGE_CHECKSUM_FILE")"
  actual_checksum="$(/usr/bin/shasum -a 256 "$PACKAGE_ARCHIVE" | /usr/bin/awk '{print $1}')"
  if [ "$actual_checksum" != "$expected_checksum" ]; then
    show_error '应用内分发包校验失败，请重新获取应用。'
    return 1
  fi

  install_root="$PACKAGES_ROOT/.install-$$"
  extracted_root="$install_root/$PACKAGE_NAME"
  mkdir -p "$install_root"
  log_event "Installing $PACKAGE_NAME"
  if ! /usr/bin/tar -xzf "$PACKAGE_ARCHIVE" -C "$install_root" >>"$LOG_FILE" 2>&1; then
    fail_install "$install_root" '无法解压应用内分发包，请打开日志查看详情。'
    return 1
  fi
  if [ ! -d "$extracted_root" ] || [ ! -f "$extracted_root/SHA256SUMS" ]; then
    fail_install "$install_root" '应用内分发包结构无效，请重新获取应用。'
    return 1
  fi
  if ! (cd "$extracted_root" && /usr/bin/shasum -a 256 -c SHA256SUMS) >>"$LOG_FILE" 2>&1; then
    fail_install "$install_root" '分发包文件校验失败，请重新获取应用。'
    return 1
  fi
  if ! mv "$extracted_root" "$PACKAGE_ROOT"; then
    fail_install "$install_root" '无法安装应用数据，请打开日志查看详情。'
    return 1
  fi
  rmdir "$install_root" 2>/dev/null || true
  touch "$PACKAGE_ROOT/.xiaobai-app-installed"
  chmod 700 "$RUN_SCRIPT" "$STOP_SCRIPT"
  log_event "Installed $PACKAGE_NAME"
}

ensure_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    if [ ! -f "$PACKAGE_ROOT/deploy/openhands/.env.example" ]; then
      show_error '应用内缺少模型配置模板，请重新获取应用。'
      return 1
    fi
    cp "$PACKAGE_ROOT/deploy/openhands/.env.example" "$CONFIG_FILE"
    chmod 600 "$CONFIG_FILE"
    log_event 'Created model configuration template'
  fi

  if [ ! -f "$CONFIG_MIGRATION_MARKER" ]; then
    /usr/bin/sed -i '' -E "s/^OPENHANDS_PORT=8000$/OPENHANDS_PORT=$APP_DEFAULT_PORT/" "$CONFIG_FILE"
    if /usr/bin/grep -q '^XIAOBAI_CONTROL_PLANE_PORT=' "$CONFIG_FILE"; then
      /usr/bin/sed -i '' -E "s/^XIAOBAI_CONTROL_PLANE_PORT=18002$/XIAOBAI_CONTROL_PLANE_PORT=$APP_DEFAULT_CONTROL_PLANE_PORT/" "$CONFIG_FILE"
    else
      printf '\nXIAOBAI_CONTROL_PLANE_PORT=%s\n' "$APP_DEFAULT_CONTROL_PLANE_PORT" >>"$CONFIG_FILE"
    fi
    touch "$CONFIG_MIGRATION_MARKER"
    chmod 600 "$CONFIG_MIGRATION_MARKER"
    log_event "Migrated application default ports to Canvas $APP_DEFAULT_PORT and control plane $APP_DEFAULT_CONTROL_PLANE_PORT"
  fi
  chmod 600 "$CONFIG_FILE"
}

config_is_ready() {
  /bin/bash -c '
    source "$1" >/dev/null 2>&1 || exit 1
    [ -n "${LLM_API_KEY:-}" ] && [ -n "${LLM_MODEL:-}" ]
  ' _ "$CONFIG_FILE"
}

configured_port() {
  local port
  port="$(/bin/bash -c '
    source "$1" >/dev/null 2>&1 || exit 1
    printf "%s" "${OPENHANDS_PORT:-8000}"
  ' _ "$CONFIG_FILE" 2>/dev/null || printf '8000')"
  if [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ]; then
    printf '%s' "$port"
  else
    printf '8000'
  fi
}

configured_control_plane_port() {
  local port
  port="$(/bin/bash -c '
    source "$1" >/dev/null 2>&1 || exit 1
    printf "%s" "${XIAOBAI_CONTROL_PLANE_PORT:-18002}"
  ' _ "$CONFIG_FILE" 2>/dev/null || printf '18002')"
  if [[ "$port" =~ ^[0-9]+$ ]] && [ "$port" -ge 1 ] && [ "$port" -le 65535 ]; then
    printf '%s' "$port"
  else
    printf '18002'
  fi
}

configured_runtime_root() {
  /bin/bash -c '
    source "$1" >/dev/null 2>&1 || exit 1
    printf "%s" "${OPENHANDS_RUNTIME_ROOT:-}"
  ' _ "$CONFIG_FILE" 2>/dev/null || true
}

canvas_url() {
  local port
  port="$(configured_port)"
  printf 'http://localhost:%s/canvas' "$port"
}

app_runtime_root() {
  local runtime_root
  runtime_root="$(configured_runtime_root)"
  if [ -n "$runtime_root" ]; then
    printf '%s' "$runtime_root"
  else
    printf '%s/runtime' "$PACKAGE_ROOT"
  fi
}

open_config() {
  ensure_payload || return 1
  ensure_config || return 1
  /usr/bin/open -a TextEdit "$CONFIG_FILE"
  show_message '请填写 LLM_API_KEY 和 LLM_MODEL，保存后重新打开本应用并选择“启动并打开 Canvas”。配置文件仅保存在当前用户的 Application Support 中。'
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    show_error '没有找到 Docker。请先安装 Docker Desktop，然后重新打开本应用。'
    return 1
  fi
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  if [ -d '/Applications/Docker.app' ]; then
    log_event 'Starting Docker Desktop'
    /usr/bin/open -a Docker >/dev/null 2>&1 || true
    show_notification '正在启动 Docker Desktop，请稍候。'
    local attempt
    for attempt in {1..60}; do
      if docker info >/dev/null 2>&1; then
        log_event 'Docker Desktop is ready'
        return 0
      fi
      sleep 2
    done
  fi
  show_error 'Docker Engine 未就绪。请确认 Docker Desktop 已启动后重试。'
  return 1
}

service_is_running() {
  docker ps --format '{{.Names}}' 2>/dev/null | /usr/bin/grep -qx "$APP_COMPOSE_PROJECT-agent-canvas-1"
}

service_exists() {
  docker ps -a --format '{{.Names}}' 2>/dev/null | /usr/bin/grep -qx "$APP_COMPOSE_PROJECT-agent-canvas-1"
}

cleanup_failed_service() {
  log_event "Cleaning failed $PACKAGE_NAME service"
  if ! stop_app_service; then
    show_error '上次启动留下的应用容器无法清理，请打开日志查看详情。源码模式实例没有被修改。'
    return 1
  fi
}

stop_app_service() {
  local runtime_root
  local compose_env
  local obsidian_vault_path
  local writer_lock
  runtime_root="$(app_runtime_root)"
  compose_env="$runtime_root/compose.env"
  if [ ! -f "$compose_env" ]; then
    log_event "Missing application compose environment: $compose_env"
    return 1
  fi

  if ! docker compose \
    --env-file "$compose_env" \
    -f "$PACKAGE_ROOT/deploy/openhands/compose.yaml" \
    -p "$APP_COMPOSE_PROJECT" \
    down >>"$LOG_FILE" 2>&1; then
    return 1
  fi

  obsidian_vault_path="$(/usr/bin/awk '
    index($0, "OBSIDIAN_VAULT_PATH=") == 1 {
      sub(/^OBSIDIAN_VAULT_PATH=/, "")
      print
      exit
    }
  ' "$compose_env")"
  if [ -n "$obsidian_vault_path" ]; then
    writer_lock="$obsidian_vault_path/88-学习/xiaobai/10-项目记忆/xbaiProjectCode/.xiaobai-writer.lock"
    if [ -f "$writer_lock/owner" ]; then
      rm -- "$writer_lock/owner"
    fi
    if [ -d "$writer_lock" ] && ! rmdir "$writer_lock"; then
      log_event "Writer lock contains unexpected files: $writer_lock"
      return 1
    fi
  fi
}

canvas_port_is_available() {
  local port
  local control_plane_port
  port="$(configured_port)"
  control_plane_port="$(configured_control_plane_port)"
  if /usr/bin/nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
    show_error "端口 $port 已被其他服务占用。请打开“配置模型”，把 OPENHANDS_PORT 改为其他空闲端口后重试。"
    return 1
  fi
  if /usr/bin/nc -z 127.0.0.1 "$control_plane_port" >/dev/null 2>&1; then
    show_error "端口 $control_plane_port 已被其他服务占用。请打开“配置模型”，把 XIAOBAI_CONTROL_PLANE_PORT 改为其他空闲端口后重试。"
    return 1
  fi
}

wait_for_canvas_url() {
  local url="$1"
  local attempt
  for attempt in {1..60}; do
    if /usr/bin/curl --fail --silent --output /dev/null "$url"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

open_canvas() {
  local wait_for_service="${1:-no}"
  local url
  url="$(canvas_url)"
  if [ "$wait_for_service" = 'yes' ]; then
    if wait_for_canvas_url "$url"; then
      /usr/bin/open "$url"
      return 0
    fi
    show_error "服务已经启动，但 Canvas 暂时不可访问：$url。请打开日志查看详情。"
    return 1
  fi
  if ! /usr/bin/curl --fail --silent --output /dev/null "$url"; then
    show_error 'Canvas 当前不可访问，请先选择“启动并打开 Canvas”。'
    return 1
  fi
  /usr/bin/open "$url"
}

start_service_for_window() {
  local url
  ensure_payload || return 1
  ensure_config || return 1
  if ! config_is_ready; then
    open_config
    return 1
  fi
  ensure_docker || return 1
  url="$(canvas_url)"
  if service_is_running; then
    if wait_for_canvas_url "$url"; then
      printf '%s\n' "$url"
      return 0
    fi
    show_error "服务已经启动，但 Canvas 暂时不可访问：$url。请打开日志查看详情。"
    return 1
  fi
  if service_exists; then
    cleanup_failed_service || return 1
  fi
  canvas_port_is_available || return 1

  log_event "Starting $PACKAGE_NAME for native window"
  if ! COMPOSE_PROJECT_NAME="$APP_COMPOSE_PROJECT" "$RUN_SCRIPT" --env "$CONFIG_FILE" >>"$LOG_FILE" 2>&1; then
    show_error '启动失败，请打开日志查看详情。模型 Key 不会写入日志。'
    return 1
  fi
  if wait_for_canvas_url "$url"; then
    show_notification 'tiny白 已启动。'
    log_event "Started $PACKAGE_NAME for native window"
    printf '%s\n' "$url"
    return 0
  fi
  show_error "服务已经启动，但 Canvas 暂时不可访问：$url。请打开日志查看详情。"
  return 1
}

start_service() {
  ensure_payload || return 1
  ensure_config || return 1
  if ! config_is_ready; then
    open_config
    return 1
  fi
  ensure_docker || return 1
  if service_is_running; then
    open_canvas 'yes'
    return $?
  fi
  if service_exists; then
    cleanup_failed_service || return 1
  fi
  canvas_port_is_available || return 1

  log_event "Starting $PACKAGE_NAME"
  if ! COMPOSE_PROJECT_NAME="$APP_COMPOSE_PROJECT" "$RUN_SCRIPT" --env "$CONFIG_FILE" >>"$LOG_FILE" 2>&1; then
    show_error '启动失败，请打开日志查看详情。模型 Key 不会写入日志。'
    return 1
  fi
  if open_canvas 'yes'; then
    show_notification 'tiny白 已启动。'
    log_event "Started $PACKAGE_NAME"
    return 0
  fi
  return 1
}

stop_service() {
  ensure_payload || return 1
  ensure_config || return 1
  ensure_docker || return 1
  if ! service_exists; then
    show_notification 'tiny白 当前已停止。'
    return 0
  fi

  log_event "Stopping $PACKAGE_NAME"
  if ! stop_app_service; then
    show_error '停止失败，请打开日志查看详情。运行数据和记忆没有被删除。'
    return 1
  fi
  show_notification 'tiny白 已停止，工作区和记忆已保留。'
  log_event "Stopped $PACKAGE_NAME"
}

choose_action() {
  /usr/bin/osascript <<'APPLESCRIPT' 2>/dev/null || true
set actions to {"启动并打开 Canvas", "打开 Canvas", "配置模型", "停止服务"}
set answer to choose from list actions with title "tiny白" with prompt "选择要执行的操作" default items {"启动并打开 Canvas"} OK button name "执行" cancel button name "退出"
if answer is false then return "退出"
return item 1 of answer
APPLESCRIPT
}

case "${1:-menu}" in
  --install-only)
    ensure_payload
    ensure_config
    printf 'package: %s\nconfig: %s\n' "$PACKAGE_ROOT" "$CONFIG_FILE"
    ;;
  --start)
    start_service
    ;;
  --stop)
    stop_service
    ;;
  --open)
    ensure_payload && ensure_config && open_canvas 'no'
    ;;
  --canvas-url)
    ensure_payload && ensure_config && canvas_url && printf '\n'
    ;;
  --start-window)
    start_service_for_window
    ;;
  --configure)
    open_config
    ;;
  menu)
    action="$(choose_action)"
    case "$action" in
      '启动并打开 Canvas') start_service ;;
      '打开 Canvas') ensure_payload && ensure_config && open_canvas 'no' ;;
      '配置模型') open_config ;;
      '停止服务') stop_service ;;
      *) exit 0 ;;
    esac
    ;;
  *)
    show_error '未知的应用操作。'
    exit 2
    ;;
esac
