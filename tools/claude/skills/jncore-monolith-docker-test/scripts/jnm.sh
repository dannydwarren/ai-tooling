#!/usr/bin/env bash
set -uo pipefail
export MSYS_NO_PATHCONV=1

IMAGE="${JNM_IMAGE:-node:24}"
CB="${JNM_COUCHBASE:-jnm-couchbase}"
CB_IMAGE="${JNM_COUCHBASE_IMAGE:-couchbase/server:enterprise-7.6.6}"
CB_USERNAME="${CB_USERNAME:-Administrator}"
CB_PASSWORD="${CB_PASSWORD:-password}"
CB_BUCKETS=(main state tmp)
NPMRC="{{USER_HOME_SLASH}}/.npmrc"
NET_TIMEOUT=600000
YARN_CACHE="${JNM_YARN_CACHE:-jnm-yarn-cache}"
TEST_TIMEOUT="${JNM_TEST_TIMEOUT:-60000}"
MARKER=.jnm-installed
TIMINGS_LOG="${JNM_TIMINGS_LOG:-{{REPO_ROOT_SLASH}}/tmp/logs/jnm-timings.tsv}"
RUN_START=$SECONDS
RUN_LABEL=""
RUN_WT=-

die() { echo "jnm: $*" >&2; exit 1; }

dur() {
    local s="$1"
    if [ "$s" -ge 60 ]; then printf '%dm%02ds' $((s / 60)) $((s % 60)); else printf '%ds' "$s"; fi
}

record() {
    [ -n "$RUN_LABEL" ] || return 0
    mkdir -p "$(dirname "$TIMINGS_LOG")" 2>/dev/null
    printf '%s\t%s\t%s\t%s\t%s\n' "$(date +%FT%T)" "$RUN_WT" "$1" "$2" "$3" >> "$TIMINGS_LOG" 2>/dev/null
}

timing() {
    echo "[jnm] $1: $(dur "$2")${3:+ ($3)}" >&2
    record "$RUN_LABEL > $1" "$2" "${3:-ok}"
}

finish() {
    local code=$? total=$((SECONDS - RUN_START))
    [ -n "$RUN_LABEL" ] || exit "$code"
    echo "[jnm] total: $RUN_LABEL took $(dur "$total") (exit $code)" >&2
    record "$RUN_LABEL" "$total" "$code"
    exit "$code"
}
trap finish EXIT

usage() {
    cat >&2 <<'EOF'
usage: jnm.sh <command> [args]
  up <worktree> [--couchbase]        install missing package sets, start the container
  test <worktree> [pkg] [spec...]    run tests (all packages, one package, or specs)
  lint <worktree> [pkg]              run lint (all packages or one)
  harness <worktree> <pkg> <script> [args...]
  shell <worktree>                   interactive shell in the container
  down <worktree> [--couchbase]      remove the container (and Couchbase)
  couchbase                          start and initialise the local Couchbase
  status                             show jnm containers and package sets
  timings [n]                        recent command times and per-step averages
  prune                              delete package sets no container uses
EOF
    exit 2
}

resolve_wt() {
    local wt="${1:?worktree path}"
    command -v cygpath >/dev/null 2>&1 && wt="$(cygpath -m "$wt")"
    wt="${wt%/}"
    [ -f "$wt/package.json" ] && [ -d "$wt/jncore" ] || die "$wt is not a jncore-monolith worktree"
    WT="$wt"
    NAME="jnm-$(basename "$WT")"
}

packages() {
    local f p
    echo jncore
    for f in "$WT"/*/package.json; do
        p="$(basename "$(dirname "$f")")"
        [ "$p" = jncore ] || echo "$p"
    done
}

uses_jncore() { [ "$1" != . ] && [ "$1" != jncore ] && grep -q '"@jobnimbus/jncore"' "$WT/$1/package.json"; }

set_hash() {
    local p="$1" files=("$WT/$p/package.json" "$WT/$p/yarn.lock")
    uses_jncore "$p" && files+=("$WT/jncore/package.json" "$WT/jncore/yarn.lock")
    { echo "$IMAGE"; cat "${files[@]}" 2>/dev/null; } | sha256sum | cut -c1-12
}

compute_sets_node() {
    node -e '
        const fs = require("fs"), path = require("path"), crypto = require("crypto");
        const [wt, image] = process.argv.slice(1);
        const read = (f) => { try { return fs.readFileSync(f); } catch { return Buffer.alloc(0); } };
        const pkgs = fs.readdirSync(wt).filter((d) => d !== "jncore" && fs.existsSync(path.join(wt, d, "package.json"))).sort();
        const vols = [];
        for (const p of [".", "jncore", ...pkgs]) {
            const files = [path.join(wt, p, "package.json"), path.join(wt, p, "yarn.lock")];
            if (p !== "." && p !== "jncore" && read(files[0]).toString().includes("\"@jobnimbus/jncore\"")) {
                files.push(path.join(wt, "jncore", "package.json"), path.join(wt, "jncore", "yarn.lock"));
            }
            const h = crypto.createHash("sha256").update(image + "\n");
            files.forEach((f) => h.update(read(f)));
            const vol = `jnm-nm-${p === "." ? "root" : p}-${h.digest("hex").slice(0, 12)}`;
            vols.push(vol);
            console.log(`${p}\t${vol}`);
        }
        console.log(`SIG\t${crypto.createHash("sha256").update(vols.map((v) => v + "\n").join("")).digest("hex").slice(0, 12)}`);
    ' "$WT" "$IMAGE"
}

compute_sets() {
    DIRS=() VOLS=()
    local p key dir vol
    if command -v node >/dev/null 2>&1; then
        while IFS=$'\t' read -r dir vol; do
            if [ "$dir" = SIG ]; then SIG="$vol"; else DIRS+=("$dir"); VOLS+=("$vol"); fi
        done < <(compute_sets_node)
        [ "${#VOLS[@]}" -gt 0 ] && [ -n "${SIG:-}" ] && return 0
        DIRS=() VOLS=()
    fi
    for p in . $(packages); do
        key="${p/#./root}"
        DIRS+=("$p")
        VOLS+=("jnm-nm-$key-$(set_hash "$p")")
    done
    SIG="$(printf '%s\n' "${VOLS[@]}" | sha256sum | cut -c1-12)"
}

vol_mounts() {
    local i
    for i in "${!DIRS[@]}"; do
        printf '%s\n' -v "${VOLS[$i]}:/repo/${DIRS[$i]}/node_modules"
    done
}

running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }

require_up() {
    running "$NAME" || die "$NAME is not running; run: jnm.sh up $WT"
    compute_sets
    [ "$(docker inspect -f '{{index .Config.Labels "jnm.sig"}}' "$NAME")" = "$SIG" ] \
        || die "dependencies changed since $NAME started; run: jnm.sh up $WT"
}

in_ctr() {
    local dir="$1"; shift
    docker exec -w "/repo/$dir" -e CB_HOST=localhost -e CB_USERNAME="$CB_USERNAME" -e CB_PASSWORD="$CB_PASSWORD" "$NAME" "$@"
}

missing_sets() {
    local i args=() existing
    existing=" $(docker volume ls -q --filter label=jnm=nm | tr '\n' ' ') "
    for i in "${!VOLS[@]}"; do
        case "$existing" in
            *" ${VOLS[$i]} "*) ;;
            *) docker volume create --label jnm=nm "${VOLS[$i]}" >/dev/null ;;
        esac
        args+=(-v "${VOLS[$i]}:/v/$i:ro")
    done
    docker run --rm "${args[@]}" "$IMAGE" sh -c "for d in /v/*; do [ -f \$d/$MARKER ] || basename \$d; done"
}

install_sets() {
    local missing t=$SECONDS
    missing="$(missing_sets)" || die "could not inspect package sets"
    timing "check package sets" $((SECONDS - t))
    if [ -z "$missing" ]; then
        echo "all ${#VOLS[@]} package sets already installed"
        return 0
    fi

    local i
    for i in "${!DIRS[@]}"; do mkdir -p "$WT/${DIRS[$i]}/node_modules"; done

    local tmp="$NAME-install" mounts=()
    mapfile -t mounts < <(vol_mounts)
    docker rm -f "$tmp" >/dev/null 2>&1
    docker run -d --name "$tmp" \
        -v "$WT:/repo:ro" -v "$NPMRC:/root/.npmrc:ro" -v "$YARN_CACHE:/usr/local/share/.cache/yarn" \
        "${mounts[@]}" -w /repo "$IMAGE" sleep infinity >/dev/null || die "could not start $tmp"

    local total=$SECONDS dir log attempt ok start
    for i in $missing; do
        dir="${DIRS[$i]}"
        log="/tmp/jnm-install-${dir/#./root}.log"
        ok=0
        docker exec "$tmp" sh -c ": > $log"
        for attempt in 1 2 3; do
            start=$SECONDS
            if docker exec -w "/repo/$dir" "$tmp" sh -c "echo '=== attempt $attempt' >> $log; yarn install --pure-lockfile --network-timeout $NET_TIMEOUT --non-interactive >>$log 2>&1"; then
                docker exec "$tmp" sh -c "date -u +%FT%TZ > /repo/$dir/node_modules/$MARKER"
                timing "install ${dir/#./root}" $((SECONDS - start)) "${VOLS[$i]}"
                ok=1
                break
            fi
            timing "install ${dir/#./root}" $((SECONDS - start)) "FAILED attempt $attempt"
        done
        if [ "$ok" -eq 0 ]; then
            docker exec "$tmp" tail -n 30 "$log" >&2
            docker rm -f "$tmp" >/dev/null 2>&1
            die "install failed for $dir; re-run up to retry it"
        fi
    done
    docker rm -f "$tmp" >/dev/null 2>&1
    timing "install $(echo "$missing" | wc -w) package set(s)" $((SECONDS - total))
}

cb_curl() { docker exec "$CB" curl -sf -u "$CB_USERNAME:$CB_PASSWORD" "$@"; }

cb_wait() {
    local _
    for _ in $(seq 1 "$2"); do
        eval "$1" && return 0
        sleep 2
    done
    return 1
}

couchbase_up() {
    local started=0
    if ! running "$CB"; then
        if docker inspect "$CB" >/dev/null 2>&1; then
            docker start "$CB" >/dev/null || die "could not start $CB"
        else
            docker run -d --name "$CB" "$CB_IMAGE" >/dev/null || die "could not create $CB"
        fi
        started=1
    fi

    cb_wait "docker exec $CB curl -sf -o /dev/null http://localhost:8091/ui/index.html" 90 \
        || die "$CB did not answer on 8091"

    if ! cb_curl -o /dev/null http://localhost:8091/pools/default; then
        echo "initialising cluster"
        docker exec "$CB" curl -sf -o /dev/null -X POST http://localhost:8091/clusterInit \
            -d "username=$CB_USERNAME" -d "password=$CB_PASSWORD" \
            -d services=kv,index,n1ql -d memoryQuota=1024 -d indexMemoryQuota=256 -d port=SAME \
            || die "cluster init failed"
    fi

    local b
    for b in "${CB_BUCKETS[@]}"; do
        if ! cb_curl -o /dev/null "http://localhost:8091/pools/default/buckets/$b"; then
            echo "creating bucket $b"
            cb_curl -o /dev/null -X POST http://localhost:8091/pools/default/buckets \
                -d "name=$b" -d ramQuota=128 -d replicaNumber=0 -d bucketType=couchbase \
                || die "could not create bucket $b"
        fi
    done

    for b in "${CB_BUCKETS[@]}"; do
        cb_wait "cb_curl http://localhost:8091/pools/default/buckets/$b | grep -q '\"status\":\"healthy\"'" 60 \
            || die "bucket $b not healthy"
    done
    echo "$CB ready (buckets: ${CB_BUCKETS[*]})"

    if [ "$started" -eq 1 ]; then
        local c
        for c in $(docker ps -a --filter name=^jnm- --format '{{.Names}}'); do
            [ "$c" = "$CB" ] && continue
            case "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$c")" in
                container:*) echo "warning: $c shared the old $CB network; run 'jnm.sh up <worktree> --couchbase' again" ;;
            esac
        done
    fi
}

cmd_up() {
    local couchbase=0 arg
    for arg in "$@"; do
        case "$arg" in
            --couchbase) couchbase=1 ;;
            *) die "unknown option $arg" ;;
        esac
    done
    [ -f "$NPMRC" ] || die "$NPMRC not found; private @jobnimbus packages need it"

    compute_sets
    install_sets

    local net=() want_net=default t
    if [ "$couchbase" -eq 1 ]; then
        t=$SECONDS
        couchbase_up
        timing "couchbase" $((SECONDS - t))
        net=(--network "container:$CB")
        want_net="container:$(docker inspect -f '{{.Id}}' "$CB")"
    fi

    if running "$NAME" \
        && [ "$(docker inspect -f '{{index .Config.Labels "jnm.sig"}}' "$NAME")" = "$SIG" ] \
        && { [ "$couchbase" -eq 0 ] || [ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$NAME")" = "$want_net" ]; }; then
        echo "$NAME already up"
        return 0
    fi

    local mounts=() p
    mapfile -t mounts < <(vol_mounts)
    for p in $(packages); do
        uses_jncore "$p" && mounts+=(-v "$WT/jncore/src:/repo/$p/node_modules/@jobnimbus/jncore/src")
    done

    t=$SECONDS
    docker rm -f "$NAME" >/dev/null 2>&1
    docker run -d --name "$NAME" --label "jnm.sig=$SIG" "${net[@]}" \
        -v "$WT:/repo" -v "$NPMRC:/root/.npmrc:ro" -v "$YARN_CACHE:/usr/local/share/.cache/yarn" \
        "${mounts[@]}" -w /repo \
        "$IMAGE" sleep infinity >/dev/null || die "could not start $NAME"
    echo "$NAME up ($IMAGE${net:+, network of $CB})"
    timing "start container" $((SECONDS - t))
}

test_command() {
    in_ctr "$1" env JNM_TIMEOUT="$TEST_TIMEOUT" node -e '
        const s = require("./package.json").scripts.test;
        const specs = process.argv.slice(1).map((a) => JSON.stringify(a)).join(" ");
        if (!/\bmocha\b/.test(s)) { process.stdout.write(specs ? `${s} ${specs}` : s); process.exit(0); }
        const floor = Number(process.env.JNM_TIMEOUT);
        let out = s.replace(/(-t|--timeout)\s+(\d+)/, (m, f, n) => `${f} ${Math.max(Number(n), floor)}`);
        if (specs) out = out.replace(/'"'"'[^'"'"']*\*[^'"'"']*'"'"'/, specs);
        process.stdout.write(out);
    ' "${@:2}"
}

run_package_test() {
    local pkg="$1" script
    shift
    script="$(test_command "$pkg" "$@")" || { echo "jnm: could not read $pkg test script" >&2; return 1; }
    echo "+ ($pkg) $script"
    in_ctr "$pkg" sh -c "PATH=./node_modules/.bin:\$PATH $script"
}

declare -A TOOK

run_each() {
    local label="$1" fn="$2" p t failed="" all=()
    for p in $(packages); do
        all+=("$p")
        t=$SECONDS
        if "$fn" "$p"; then
            TOOK[$p]=$((SECONDS - t))
            timing "$label $p" "${TOOK[$p]}"
        else
            TOOK[$p]=$((SECONDS - t))
            timing "$label $p" "${TOOK[$p]}" FAIL
            failed="$failed $p"
        fi
    done
    echo
    echo "=== $label summary"
    for p in "${all[@]}"; do
        case " $failed " in
            *" $p "*) printf 'FAIL %-30s %s\n' "$p" "$(dur "${TOOK[$p]}")" ;;
            *) printf 'ok   %-30s %s\n' "$p" "$(dur "${TOOK[$p]}")" ;;
        esac
    done
    [ -z "$failed" ]
}

checked_up() {
    local t=$SECONDS
    require_up
    timing "check container" $((SECONDS - t))
}

cmd_test() {
    checked_up
    if [ "$#" -gt 0 ]; then
        local t=$SECONDS rc=0
        run_package_test "$@" || rc=$?
        timing "run $1" $((SECONDS - t)) "$([ "$rc" -eq 0 ] && echo ok || echo FAIL)"
        return "$rc"
    fi
    run_each test run_package_test
}

lint_package() {
    local plugins
    plugins="$(in_ctr . sh -c 'for d in */node_modules/eslint-plugin-jest; do [ -d "$d" ] && dirname "$(dirname "$d")" && break; done')"
    echo "+ ($1) yarn lint${plugins:+ --resolve-plugins-relative-to /repo/$plugins}"
    in_ctr "$1" yarn -s lint ${plugins:+--resolve-plugins-relative-to "/repo/$plugins"}
}

cmd_lint() {
    checked_up
    if [ -n "${1:-}" ]; then
        lint_package "$1"
        return
    fi
    run_each lint lint_package
}

cmd_harness() {
    checked_up
    local pkg="${1:?package}" script="${2:?script}"
    shift 2
    case "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$NAME")" in
        container:*) ;;
        *) die "$NAME was not started with --couchbase; run: jnm.sh up $WT --couchbase" ;;
    esac
    running "$CB" || die "$CB is not running; run: jnm.sh up $WT --couchbase"
    in_ctr "$pkg" bash "$script" "$@"
}

cmd_shell() {
    require_up
    docker exec -it -w /repo "$NAME" bash
}

cmd_down() {
    local arg
    docker rm -f "$NAME" >/dev/null 2>&1 && echo "$NAME removed" || echo "$NAME not present"
    for arg in "$@"; do
        case "$arg" in
            --couchbase) docker rm -f "$CB" >/dev/null 2>&1 && echo "$CB removed" || echo "$CB not present" ;;
            *) die "unknown option $arg" ;;
        esac
    done
}

cmd_status() {
    docker ps -a --filter name=^jnm- --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
    echo
    echo "package sets in use:"
    comm -23 <(docker volume ls -q --filter label=jnm=nm | sort) <(docker volume ls -q --filter label=jnm=nm --filter dangling=true | sort) | sed 's/^/  /'
    echo "package sets unused (removed by prune):"
    docker volume ls -q --filter label=jnm=nm --filter dangling=true | sed 's/^/  /'
}

cmd_timings() {
    local n="${1:-15}"
    [ -f "$TIMINGS_LOG" ] || { echo "no timings recorded yet ($TIMINGS_LOG)"; return 0; }
    echo "=== last $n commands"
    awk -F'\t' '$3 !~ / > /' "$TIMINGS_LOG" | tail -n "$n" | awk -F'\t' '
        function d(s) { return s >= 60 ? sprintf("%dm%02ds", s / 60, s % 60) : s "s" }
        { printf "%s  %-32s %8s  exit %s  %s\n", $1, $3, d($4), $5, $2 }'
    echo
    echo "=== per command and step (all runs; fails = non-zero exit or FAIL)"
    awk -F'\t' '
        function d(s) { return s >= 60 ? sprintf("%dm%02ds", s / 60, s % 60) : s "s" }
        { k = $3; c[k]++; t[k] += $4; l[k] = $4; if ($4 > m[k]) m[k] = $4; if ($5 != "0" && $5 != "ok") f[k]++ }
        END {
            printf "%-44s %5s %5s %8s %8s %8s\n", "command / step", "runs", "fails", "avg", "last", "max"
            for (k in c) printf "%-44s %5d %5d %8s %8s %8s\n", k, c[k], f[k], d(int(t[k] / c[k])), d(l[k]), d(m[k])
        }' "$TIMINGS_LOG" | { read -r h; echo "$h"; sort; }
    echo
    echo "log: $TIMINGS_LOG"
}

cmd_prune() {
    local v n=0
    for v in $(docker volume ls -q --filter label=jnm=nm --filter dangling=true); do
        docker volume rm "$v" >/dev/null && echo "removed $v" && n=$((n + 1))
    done
    echo "pruned $n package set(s)"
}

CMD="${1:-}"
[ -n "$CMD" ] || usage
shift

run_label() {
    case "$CMD" in
        test)
            if [ "$#" -gt 1 ]; then echo "test $1 (specs)"; else echo "test ${1:-(all)}"; fi ;;
        lint) echo "lint ${1:-(all)}" ;;
        harness) echo "harness ${1:-} $(basename "${2:-}")" ;;
        up) echo up ;;
        *) echo "$CMD" ;;
    esac
}

case "$CMD" in
    couchbase) RUN_LABEL=couchbase; couchbase_up ;;
    status) cmd_status ;;
    prune) cmd_prune ;;
    timings) cmd_timings "$@" ;;
    up|test|lint|harness|shell|down)
        resolve_wt "${1:-}"
        shift
        RUN_WT="$(basename "$WT")"
        case "$CMD" in shell|down) ;; *) RUN_LABEL="$(run_label "$@")" ;; esac
        case "$CMD" in
            up) cmd_up "$@" ;;
            test) cmd_test "$@" ;;
            lint) cmd_lint "$@" ;;
            harness) cmd_harness "$@" ;;
            shell) cmd_shell ;;
            down) cmd_down "$@" ;;
        esac ;;
    *) usage ;;
esac
