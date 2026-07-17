#!/bin/bash
# Tripwire runner. Rules live in tripwires.conf next to this script.
#   --staged  scan content staged for commit (used by the pre-commit hook)
#   --all     scan every tracked file (used by CI)
# Exit 1 on any hit. Must work on macOS bash 3.2 with no dependencies.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONF="$HERE/tripwires.conf"
MODE="${1:---all}"
cd "$(git rev-parse --show-toplevel)"

case "$MODE" in
  --staged) FILES=$(git diff --cached --name-only --diff-filter=ACM) ;;
  --all)    FILES=$(git ls-files) ;;
  *) echo "usage: run-tripwires.sh [--staged|--all]" >&2; exit 2 ;;
esac
[ -z "$FILES" ] && exit 0

content_of() {
  if [ "$MODE" = "--staged" ]; then git show ":$1" 2>/dev/null; else cat "$1" 2>/dev/null; fi
}

ext_matches() { # $1=file $2=comma-list or *
  [ "$2" = "*" ] && return 0
  case ",$2," in *",${1##*.},"*) return 0 ;; esac
  return 1
}

FAIL=0
while IFS= read -r rule; do
  case "$rule" in ''|'#'*) continue ;; esac
  id="${rule%% :: *}"; rest="${rule#* :: }"
  exts="${rest%% :: *}"; rest="${rest#* :: }"
  regex="${rest%% :: *}"; fix="${rest#* :: }"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    # The rule patterns appear as text inside the hooks bundle itself
    # (here at hooks/; inside product repos at .mfactory/hooks/).
    case "$f" in hooks/*|.mfactory/hooks/*) continue ;; esac
    ext_matches "$f" "$exts" || continue
    # -e guards against patterns that start with a dash (grep would parse them
    # as options and fail silently behind the || true — caught in testing).
    hits=$(content_of "$f" | grep -nEI -e "$regex" | grep -v "mfactory-allow:$id" || true)
    if [ -n "$hits" ]; then
      FAIL=1
      {
        printf 'BLOCKED [%s] %s\n' "$id" "$f"
        printf '%s\n' "$hits" | sed 's/^/  line /'
        printf '  Fix: %s\n' "$fix"
      } >&2
    fi
  done <<EOF
$FILES
EOF
done < "$CONF"

exit $FAIL
