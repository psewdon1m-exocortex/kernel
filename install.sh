#!/usr/bin/env sh
set -eu

ACTION="${1:-install}"
INSTALL_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="$INSTALL_DIR/.env"

require_root() {
  [ "$(id -u)" -eq 0 ] || { echo "Run kernel-install as root." >&2; exit 4; }
}

get_env() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

set_env() {
  key=$1
  value=$2
  temporary="$ENV_FILE.tmp"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" >"$temporary"
  chmod 0600 "$temporary"
  mv "$temporary" "$ENV_FILE"
}

needs_generation() {
  current=$(get_env "$1")
  [ -z "$current" ] || [ "$current" = "CHANGE_ME" ] ||
    case "$current" in replace-*) true ;; *) false ;; esac
}

random_hex() {
  openssl rand -hex "$1"
}

install_command() {
  install -d -m 0755 /usr/local/sbin
  wrapper=/usr/local/sbin/kernel-install
  {
    echo '#!/usr/bin/env sh'
    printf 'exec "%s/install.sh" "$@"\n' "$INSTALL_DIR"
  } >"$wrapper"
  chmod 0755 "$wrapper"
}

prepare_neptune_mounts() {
  getent group neptune-clients >/dev/null 2>&1 || groupadd --system neptune-clients
  neptune_gid=$(getent group neptune-clients | cut -d: -f3)
  install -d -o root -g neptune-clients -m 0770 /run/neptune
  install -d -o root -g neptune-clients -m 0750 /etc/neptune/clients
  for token_file in /etc/neptune/clients/kernel.control.token /etc/neptune/clients/kernel.export.token; do
    if [ ! -s "$token_file" ]; then umask 0027; random_hex 32 >"$token_file"; fi
    chown root:neptune-clients "$token_file"; chmod 0640 "$token_file"
  done
  set_env NEPTUNE_SOCKET_GID "$neptune_gid"
  set_env NEPTUNE_CONTROL_TOKEN_HOST_FILE /etc/neptune/clients/kernel.control.token
  set_env NEPTUNE_EXPORT_TOKEN_HOST_FILE /etc/neptune/clients/kernel.export.token
}

enable_backup() {
  require_root
  [ -f "$ENV_FILE" ] || { echo "Install Kernel first." >&2; exit 2; }
  command -v updater >/dev/null 2>&1 || { echo "Updater is required." >&2; exit 3; }
  prepare_neptune_mounts
  updater neptune install --head kernel
  enrollment_code=${NEPTUNE_ENROLLMENT_CODE:-}
  if [ -z "$enrollment_code" ]; then printf 'Saturn one-time setup code: ' >&2; stty -echo; trap 'stty echo' EXIT HUP INT TERM; IFS= read -r enrollment_code; stty echo; trap - EXIT HUP INT TERM; printf '\n' >&2; fi
  port=$(get_env KERNEL_LISTEN_PORT); port=${port:-18180}
  printf '%s\n' "$enrollment_code" | updater neptune enroll --head kernel --project kernel --export-url "http://127.0.0.1:$port/api/internal/neptune/backup"
  unset enrollment_code
  echo "Kernel automatic backup is connected. Manage its schedule in Saturn Synchronization."
}

prepare() {
  require_root
  command -v openssl >/dev/null 2>&1 || {
    echo "openssl is required. Prepare the VPS with Sindri first." >&2
    exit 3
  }
  if [ ! -f "$ENV_FILE" ]; then
    cp "$INSTALL_DIR/.env.example" "$ENV_FILE"
  fi
  chmod 0600 "$ENV_FILE"
  needs_generation KERNEL_SESSION_SECRET && set_env KERNEL_SESSION_SECRET "$(random_hex 32)"
  needs_generation KERNEL_SERVICE_TOKEN && set_env KERNEL_SERVICE_TOKEN "$(random_hex 32)"
  needs_generation UPDATER_CONTROL_TOKEN && set_env UPDATER_CONTROL_TOKEN "$(random_hex 32)"
  set_env UPDATER_COMPOSE_PROJECT_DIR "$INSTALL_DIR"
  if [ -n "${KERNEL_RELEASE_VERSION:-}" ]; then
    set_env KERNEL_VERSION "$KERNEL_RELEASE_VERSION"
  fi
  if [ -n "${KERNEL_RELEASE_IMAGE:-}" ]; then
    set_env KERNEL_IMAGE "$KERNEL_RELEASE_IMAGE"
  fi
  install_command
  prepare_neptune_mounts
  echo "Kernel files are prepared in $INSTALL_DIR"
  echo "Edit only the OPERATOR INPUT section in $ENV_FILE"
  echo "Then run: sudo kernel-install"
}

validate_install() {
  [ -f "$ENV_FILE" ] || { echo "Run the Kernel bootstrap command first." >&2; exit 2; }
  for command in docker curl openssl; do
    command -v "$command" >/dev/null 2>&1 || {
      echo "$command is required. Prepare the VPS with Sindri first." >&2
      exit 3
    }
  done
  docker compose version >/dev/null 2>&1 || {
    echo "Docker Compose v2 is required." >&2
    exit 3
  }
  access_key=$(get_env KERNEL_ACCESS_KEY)
  if [ -z "$access_key" ]; then
    access_key=$(get_env KERNEL_ADMIN_PASSWORD)
  fi
  public_url=$(get_env KERNEL_URL)
  image=$(get_env KERNEL_IMAGE)
  case "$access_key" in ""|CHANGE_ME|change-*) echo "Set KERNEL_ACCESS_KEY in .env." >&2; exit 2 ;; esac
  [ "${#access_key}" -ge 12 ] || { echo "KERNEL_ACCESS_KEY must contain at least 12 characters." >&2; exit 2; }
  case "$public_url" in https://*.*) ;; *) echo "KERNEL_URL must be the public HTTPS URL." >&2; exit 2 ;; esac
  case "$public_url" in *CHANGE_ME*|*.example.com*) echo "Replace the example KERNEL_URL." >&2; exit 2 ;; esac
  printf '%s' "$image" | grep -Eq '^ghcr\.io/.+@sha256:[a-f0-9]{64}$' || {
    echo "KERNEL_IMAGE was not populated from a valid release." >&2
    exit 2
  }
  docker pull "$image" >/dev/null || {
    echo "Cannot pull the Kernel image. Make the GHCR package public or authenticate Docker to ghcr.io." >&2
    exit 14
  }
  set_env UPDATER_PUBLIC_HEALTH_URL ""
}

install_kernel() {
  require_root
  validate_install
  prepare_neptune_mounts
  cd "$INSTALL_DIR"
  "$INSTALL_DIR/updater/install.sh" kernel "$ENV_FILE" "$INSTALL_DIR/updater/updater-linux-amd64"
  docker compose --env-file "$ENV_FILE" -f compose.production.yaml config -q
  docker compose --env-file "$ENV_FILE" -f compose.production.yaml up -d
  port=$(get_env KERNEL_LISTEN_PORT)
  port=${port:-18180}
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:$port/api/health" >/dev/null; then
      echo "Kernel is healthy at $(get_env KERNEL_URL)"
      return 0
    fi
    sleep 2
  done
  docker compose --env-file "$ENV_FILE" -f compose.production.yaml ps >&2
  echo "Kernel did not become healthy within 60 seconds." >&2
  exit 15
}

case "$ACTION" in
  prepare) prepare ;;
  install) install_kernel ;;
  status)
    require_root
    cd "$INSTALL_DIR"
    docker compose --env-file "$ENV_FILE" -f compose.production.yaml ps
    ;;
  backup) enable_backup ;;
  *) echo "Usage: kernel-install [install|prepare|status|backup]" >&2; exit 2 ;;
esac
