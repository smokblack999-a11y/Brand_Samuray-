#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

ROOT="${SAMURAI_ROOT:-$HOME/SamuraiOS}"
CORE="$ROOT/core"
CONFIG_DIR="$HOME/.config/samuraios"
CREDENTIAL="$CONFIG_DIR/launcher.cred"
PID_FILE="$CONFIG_DIR/core.pid"
LOG_FILE="$HOME/samurai-core.log"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
pause() { read -r -p $'\nНажмите Enter для продолжения...' _; }

setup_password() {
  mkdir -p "$CONFIG_DIR"
  chmod 700 "$CONFIG_DIR"
  command -v openssl >/dev/null 2>&1 || die "Установите openssl: pkg install openssl"
  local p1 p2 salt hash
  while true; do
    read -r -s -p "Создайте пароль лаунчера (минимум 10 символов): " p1; printf '\n'
    (("${#p1}" >= 10)) || { echo "Слишком короткий пароль."; continue; }
    read -r -s -p "Повторите пароль: " p2; printf '\n'
    [[ "$p1" == "$p2" ]] || { echo "Пароли не совпадают."; continue; }
    salt="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
    hash="$(openssl passwd -6 -salt "$salt" "$p1")"
    printf '%s\n%s\n' "$salt" "$hash" > "$CREDENTIAL"
    chmod 600 "$CREDENTIAL"
    unset p1 p2
    echo "Пароль создан локально; в репозиторий он не записывается."
    return
  done
}

authenticate() {
  [[ -f "$CREDENTIAL" ]] || setup_password
  local salt expected entered actual tries
  salt="$(sed -n '1p' "$CREDENTIAL")"
  expected="$(sed -n '2p' "$CREDENTIAL")"
  [[ -n "$salt" && -n "$expected" ]] || die "Файл пароля повреждён: $CREDENTIAL"
  for tries in 1 2 3; do
    read -r -s -p "Пароль SAMURAI: " entered; printf '\n'
    actual="$(openssl passwd -6 -salt "$salt" "$entered")"
    unset entered
    if [[ "$actual" == "$expected" ]]; then
      echo "Доступ разрешён."
      return
    fi
    echo "Неверный пароль ($tries/3)."
  done
  die "Доступ заблокирован до следующего запуска."
}

ensure_project() {
  [[ -d "$ROOT" ]] || die "Проект не найден: $ROOT. Сначала клонируйте репозиторий."
  [[ -f "$CORE/package.json" ]] || die "Не найден core/package.json"
}

install_core() {
  ensure_project
  cd "$CORE"
  if [[ ! -f .env && -f .env.example ]]; then
    cp .env.example .env
    chmod 600 .env
    echo "Создан core/.env из шаблона. Заполните ключи перед использованием сетевых функций."
  fi
  if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
  echo "Зависимости установлены. Это не подтверждает настройку API-ключей."
}

start_core() {
  ensure_project
  cd "$CORE"
  if [[ ! -f .env ]]; then
    echo "Нет core/.env. Сначала выберите пункт 1 и настройте конфигурацию."
    return 1
  fi
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Core уже запущен, PID $(cat "$PID_FILE")."
    return
  fi
  if [[ ! -d node_modules ]]; then
    echo "Нет node_modules. Сначала выберите пункт 1."
    return 1
  fi
  mkdir -p "$CONFIG_DIR"
  nohup node server.js >> "$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"
  sleep 2
  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Процесс запущен (PID $(cat "$PID_FILE")). Проверка HTTP:"
    curl --max-time 3 -fsS http://127.0.0.1:${PORT:-8787}/health || echo "Health пока не подтверждён; смотрите логи."
  else
    echo "Core завершился при старте. Последние логи:"
    tail -n 50 "$LOG_FILE" 2>/dev/null || true
    rm -f "$PID_FILE"
    return 1
  fi
}

stop_core() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      echo "Сигнал остановки отправлен процессу $pid."
    else
      echo "Процесс не запущен."
    fi
    rm -f "$PID_FILE"
  else
    echo "PID-файл не найден."
  fi
}

status_core() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Процесс: RUNNING (PID $(cat "$PID_FILE"))"
  else
    echo "Процесс: STOPPED / PID неизвестен"
  fi
  curl --max-time 3 -sS http://127.0.0.1:${PORT:-8787}/health || true
  echo
}

diagnostics() {
  echo "===== DEVICE ====="
  uname -a
  getprop ro.build.version.release 2>/dev/null || true
  echo "===== TOOLCHAIN ====="
  command -v node >/dev/null && node --version || true
  command -v npm >/dev/null && npm --version || true
  command -v java >/dev/null && java -version 2>&1 || true
  echo "ANDROID_HOME=${ANDROID_HOME:-<unset>}"
  echo "ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT:-<unset>}"
  echo "===== PROJECT ====="
  git -C "$ROOT" status --short 2>/dev/null || true
  [[ -f "$CORE/.env" ]] && echo "core/.env: exists (values not displayed)" || echo "core/.env: missing"
  [[ -d "$CORE/node_modules" ]] && echo "node_modules: exists" || echo "node_modules: missing"
  echo "===== HEALTH ====="
  curl --max-time 3 -sS http://127.0.0.1:${PORT:-8787}/health || true
  echo
}

run_tests() {
  ensure_project
  cd "$CORE"
  npm test
}

build_apk() {
  ensure_project
  if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
    echo "Android SDK не настроен. Для надёжной сборки используйте GitHub Actions workflow android.yml."
    echo "Termux на 32-bit userspace может не поддерживать AAPT2; не будем объявлять локальную сборку успешной без APK."
    return 1
  fi
  cd "$ROOT/android"
  chmod +x ./gradlew
  ./gradlew assembleDebug
  echo "APK должен находиться в android/app/build/outputs/apk/debug/app-debug.apk"
}

authenticate
ensure_project

while true; do
  cat <<'MENU'

========== SAMURAI OS · X10THINC ==========
 1  Установить Core зависимости
 2  Запустить Core в фоне
 3  Остановить Core
 4  Статус системы
 5  Запустить тесты
 6  Показать логи
 7  Диагностика проекта
 8  Собрать Android APK (если SDK поддерживается)
 9  Сменить локальный пароль
 0  Выход
===========================================
MENU
  read -r -p "SAMURAI > " choice
  case "$choice" in
    1) install_core; pause ;;
    2) start_core; pause ;;
    3) stop_core; pause ;;
    4) status_core; pause ;;
    5) run_tests; pause ;;
    6) tail -n 200 "$LOG_FILE" 2>/dev/null || echo "Логов пока нет."; pause ;;
    7) diagnostics; pause ;;
    8) build_apk; pause ;;
    9) rm -f "$CREDENTIAL"; setup_password; pause ;;
    0) exit 0 ;;
    *) echo "Неизвестная команда"; pause ;;
  esac
done
