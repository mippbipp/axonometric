// Flake update pipeline for mippbipp/conf.nix.
// Read from source at commit 9d26a4d (2026-11-02). Ruleset read live from
// the GitHub API the same day.

const C = "9d26a4d";

const required = [
  "checks aarch64-linux",
  "checks x86_64-linux",
  "build aarch64-linux",
  "build x86_64-linux",
  "flake-update-scope",
];

export default {
  format: 1,
  revision: 0,

  overview: {
    title: "Flake update pipeline",
    summary:
      "Every Monday around 02:00 a timer on pewter runs the Updater. It runs nix flake update on one long-lived flake-update branch and keeps a single pull request open against main. GitHub Actions then builds every NixOS host on both architectures, and a ruleset on main refuses the merge until five checks are green. If the build gate is red, the Updater can hand the failure to the Flake fixer, an opencode agent in a sandbox, and the Updater alone commits and pushes whatever the agent does. A monthly watchdog fails if flake.lock has not changed for 30 days. The invariant is that main is always buildable for every NixOS host.",
    stats: [
      { label: "Required checks on main", value: "5 (read from the ruleset API on 2026-11-02)" },
      { label: "NixOS hosts", value: "4: gram, harpe, warpe on x86_64-linux; pewter on aarch64-linux" },
      { label: "Root flake inputs", value: "21 in flake.lock on 2026-11-02" },
      { label: "Repair rounds per run", value: "3 at most" },
      { label: "Repair deadline", value: "11.5 hours, inside the unit's 12 hour hard stop" },
      { label: "Watchdog threshold", value: "flake.lock last changed more than 30 days ago" },
    ],
    decisions: [
      {
        topic: "Verification",
        decision:
          "Main must always build for every nixosConfigurations entry. Testing runs on GitHub runners before merge, because only they give native x86_64 and aarch64 compute for free. Pewter only rebuilds after merge, since activation can only be tried by deploying.",
        adr: "https://example.com/x",
      },
      {
        topic: "Who orchestrates",
        decision:
          "Pewter runs the Updater because it is always on and already git-authenticated. Actions-only was rejected because nothing persistent could own the branch and PR.",
        adr: "https://example.com/x",
      },
      {
        topic: "Agent instead of reverting inputs",
        decision:
          "Most red weeks are caused by our configuration, not an input. PR #232 broke on removed boot.initrd options, and reverting nixpkgs would have hidden a two-line fix. Judging that needs the gate log, the lock diff and upstream source.",
        adr: "https://example.com/x",
      },
      {
        topic: "Agent cannot push",
        decision:
          "The Flake fixer edits a copy of the tree in its own sandbox. The Updater reads the copy back, checks it, commits and pushes. A fixer code change turns auto-merge off so a person reads it.",
        adr: "https://example.com/x",
      },
      {
        topic: "Gate shape",
        decision:
          "One job per architecture builds every host of that arch in one /nix/store, so shared derivations compile once. Hosts are enumerated from the flake at CI time, so adding a host of a covered arch touches no workflow.",
        adr: "https://example.com/x",
      },
      {
        topic: "Scope check runs main's copy",
        decision:
          "flake-update-scope uses pull_request_target and reads blocked-paths.json from the base branch, so a commit on the PR cannot weaken the check that guards it.",
        adr: "https://example.com/x",
      },
    ],
    platformProvides:
      "systemd timers with Persistent and a randomized delay. GitHub Actions runners for x86_64-linux (ubuntu-latest) and aarch64-linux (ubuntu-24.04-arm). GitHub rulesets with required status checks, and auto-merge. opencode serve with permission policies for the agent. Attic, the Nix binary cache server.",
    weOwn:
      "The Updater, a TypeScript/Effect program in hosts/pewter/flake-updater/. The three workflows: build-gate, flake-update-scope, update-watchdog. blocked-paths.json, the one list of paths the Flake fixer may never change. The Flake fixer's sandbox and policies in default.nix and opencode-config.nix. The ruleset's contents, kept by hand on GitHub.",
    fileLayout: `.github/workflows/
  build-gate.yml          build-closure and checks jobs, per arch
  flake-update-scope.yml  blocked-path check on the flake-update PR
  watchdog.yml            monthly flake.lock age check
hosts/pewter/
  attic.nix               the Attic cache
  flake-updater/
    default.nix           timer, service, fixer server, sandbox
    package.nix           the packaged Updater, with checks
    blocked-paths.json    paths the Flake fixer may not change
    opencode-config.nix   hard policies for the fixer's server
    src/
      main.ts             CLI entry, wires the live layers
      updater.ts          run, repair loop, issues and PR body
      repair-round.ts     one fixer round and the checks on it
      git.ts, live/git.ts checkout, sync, export and import of trees
      live/gate.ts        ruleset and check-run polling
      gate-log.ts         trims failed logs to Nix error blocks
      lock.ts             flake.lock parsing, reverts, classification
      branch-state.ts     PR state derived from commits and issues
docs/adr/
  0009-flake-update-pipeline.md
  0018-per-arch-build-gate.md`,
    deepDives: [
      {
        title: "ADR 0009 and runbook",
        summary: "The decision, the Updater run step by step, the Flake fixer round, recovery evidence.",
        link: "https://example.com/x",
      },
      {
        title: "ADR 0018: per-arch gate jobs",
        summary: "Why one job per arch sharing a store replaced one job per host.",
        link: "https://example.com/x",
      },
      {
        title: "Pewter host README",
        summary: "Turning the fixer on and off, first deploy checks, dry runs.",
        link: "https://example.com/x",
      },
      {
        title: "Adding a host",
        summary: "Which pipeline surfaces a new host or a new arch touches.",
        link: "https://example.com/x",
      },
    ],
  },

  groups: [
    { id: "pewter", title: "pewter" },
    { id: "repo", title: "GitHub repository" },
    { id: "actions", title: "GitHub Actions" },
    { id: "upstream", title: "Upstream" },
    { id: "people", title: "People" },
  ],

  structures: [
    {
      id: "timer",
      code: "T",
      name: "Update timer",
      shape: "job",
      group: "pewter",
      status: "live",
      oneLiner: "Starts the Updater on Mondays around 02:00.",
      whatItDoes:
        "A systemd timer on pewter. It fires once a week, runs a missed job after boot, and waits a random delay so it does not start on the dot.",
      howItsBuilt:
        "systemd.timers.flake-updater in hosts/pewter/flake-updater/default.nix: OnCalendar = Mon *-*-* 02:00:00, Persistent = true, RandomizedDelaySec = 30m. It starts flake-updater.service, a oneshot with TimeoutStartSec = 12h.",
      sources: [{ path: "hosts/pewter/flake-updater/default.nix", commit: C }],
    },
    {
      id: "updater",
      code: "U",
      name: "Updater",
      shape: "tall",
      group: "pewter",
      status: "live",
      oneLiner: "Maintains the one flake-update branch and PR, and drives repair rounds.",
      whatItDoes:
        "Bumps the flake inputs on a stable branch, opens or refreshes a single pull request, and keeps its body and auto-merge setting correct. When the Flake fixer is on, it waits for the build gate and asks the fixer for help while the gate is red. It is the only part that holds the GitHub token, runs git, or pushes.",
      howItsBuilt:
        "TypeScript on Effect, run by Node 24 straight from src/main.ts, packaged in package.nix. The service runs as the configured pewter user with the SOPS secret github_token, in the clone at /var/lib/flake-updater. Git runs with hooks off and gh's credential helper in .git/updater.gitconfig. The package's check phase runs typecheck, tests, formatter and linter, so the aarch64 build job tests every change to it. `flake-updater --dry-run` updates a scratch clone, prints the PR body, and pushes nothing.",
      steps: [
        {
          name: "Prepare",
          detail:
            "Clone if missing, set up gh as the credential helper, abort any half-done merge, fetch origin without submodules.",
        },
        {
          name: "Sync the branch",
          detail:
            "With an open PR: check out origin/flake-update and merge origin/main. A flake.lock-only conflict takes main's copy. Any other conflict drops the PR's commits, logs their SHAs and starts over from main. With no PR: start from main.",
        },
        {
          name: "Update the lock",
          detail:
            "Close held-back issues whose input main has moved past, run nix flake update, commit flake.lock as 'up' if it changed.",
        },
        {
          name: "Stop if nothing differs",
          detail: "If the branch has no diff from origin/main, log 'already current' and exit.",
        },
        {
          name: "Push and open the PR",
          detail:
            "Fast-forward push for a continued branch, --force-with-lease for one that started over. Create the PR if absent, then rewrite its body and request squash auto-merge.",
        },
        {
          name: "Repair loop",
          detail:
            "Only with the Flake fixer on: wait for the gate on the pushed commit, run up to three rounds while it is red, report a failure issue if the loop stops or hits 11.5 hours.",
        },
      ],
      questions: [
        {
          id: "Q-U1",
          state: "open",
          text: "The gate waits on, and fails on, every check in the PR's rollup, not only the five required ones, so a failing optional check such as Greptile Review would stop repair as 'outside the Build gate'. Is that intended?",
        },
        {
          id: "Q-U2",
          state: "open",
          text: "The Updater closes a 'repair failed' issue only when a later run sees a green gate, so issue #236 (opened 2026-11-02 15:29 UTC, PR #235 merged 18:29, issue closed by mippbipp 21:17) stayed open after the PR merged. Should it also close when the PR has merged?",
        },
      ],
      sources: [
        { path: "hosts/pewter/flake-updater/src/updater.ts", commit: C },
        { path: "hosts/pewter/flake-updater/src/main.ts", commit: C },
        { path: "hosts/pewter/flake-updater/src/live/git.ts", commit: C },
        { path: "hosts/pewter/flake-updater/package.nix", commit: C },
      ],
    },
    {
      id: "inputs",
      code: "UP",
      name: "Flake inputs",
      shape: "external",
      group: "upstream",
      status: "live",
      oneLiner: "The 21 upstream flakes that flake.lock pins, nixpkgs among them.",
      whatItDoes:
        "The projects whose newer revisions the Updater pulls in each week. Most follow nixpkgs, so a nixpkgs change moves most of the lock.",
      howItsBuilt:
        "Declared in flake.nix; the resolved revisions live in flake.lock. nix flake update fetches the newest revision of each from its source.",
      sources: [{ path: "flake.lock", commit: C }],
    },
    {
      id: "main",
      code: "M",
      name: "main branch",
      tag: "main",
      shape: "store",
      group: "repo",
      status: "live",
      oneLiner: "The default branch, which must always build for every host.",
      whatItDoes:
        "Holds the configuration of every host. Each merged update lands as one squashed commit. Pewter itself is rebuilt from main by hand with nrs pewter, after the merge.",
      howItsBuilt:
        "mippbipp/conf.nix on GitHub, a public repository. Deleting main and force-pushing it are blocked by the ruleset.",
      sources: [{ path: "flake.nix", commit: C }],
    },
    {
      id: "pr",
      code: "PR",
      name: "flake-update PR",
      shape: "document",
      group: "repo",
      status: "live",
      oneLiner: "The single accumulating pull request from the flake-update branch.",
      whatItDoes:
        "Carries the week's lock bump. The Updater rewrites its body each run from the branch itself, listing updated inputs as name old → new, held-back inputs with their issues, and any Flake fixer commits. An open PR from an earlier week keeps its fixes, because the next run merges main into it.",
      howItsBuilt:
        "Head flake-update, base main, labels dependencies and automated, titled 'up'. The body, the ready-for-human label and the auto-merge state come from src/pr-body.ts and src/branch-state.ts. Nothing is stored outside git and GitHub, so a run that died halfway leaves nothing the next run cannot rebuild.",
      sources: [
        { path: "hosts/pewter/flake-updater/src/pr-body.ts", commit: C },
        { path: "hosts/pewter/flake-updater/src/live/github.ts", commit: C },
      ],
    },
    {
      id: "bg",
      code: "BG",
      name: "build-gate",
      shape: "gate",
      group: "actions",
      status: "live",
      oneLiner: "Builds every NixOS host on both architectures for every pull request.",
      whatItDoes:
        "The Build gate. Two jobs build all hosts of one architecture each, and two more jobs run the flake's checks. A host that fails does not hide another host's failure, and its error appears in a 'build <host>' log section.",
      howItsBuilt:
        ".github/workflows/build-gate.yml, on pull_request, cancelling older runs of the same PR. build-closure has a matrix of x86_64-linux (ubuntu-latest) and aarch64-linux (ubuntu-24.04-arm), 350 minute limit, fail-fast off. It evaluates nixosConfigurations, filters hosts by hostPlatform.system, and builds each toplevel with a per-host out-link, keeping a failure accumulator. The checks job builds every attribute of checks.<system> in 60 minutes; build-matrix-sync there fails if a host's arch has no matrix row or a row has no hosts. Closures are pushed to Attic only when the PR head is this repository.",
      steps: [
        {
          name: "Install",
          detail: "Check out without credentials, install Nix, install attic-client.",
        },
        {
          name: "List hosts",
          detail:
            "nix eval of nixosConfigurations mapped to hostPlatform.system, filtered to this job's system. An empty list is an error.",
        },
        {
          name: "Build each host",
          detail:
            "nix build the toplevel into result-<host> inside a ::group::build <host> block. A failure sets the exit status and the loop continues.",
        },
        {
          name: "Push to Attic",
          detail: "For same-repository PRs, attic push cache:fleet for every result link.",
        },
        {
          name: "Run the flake checks",
          detail:
            "The separate checks job builds each attribute of checks.<system>, including build-matrix-sync and the role-wiring checks.",
        },
      ],
      sources: [
        { path: ".github/workflows/build-gate.yml", commit: C },
        { path: "checks.nix", commit: C },
        { path: "docs/adr/0018-per-arch-build-gate.md", commit: C },
      ],
    },
    {
      id: "attic",
      code: "A",
      name: "Attic cache",
      shape: "store",
      group: "pewter",
      status: "live",
      oneLiner: "The Nix binary cache at cache.mippbipp.com/fleet, run on pewter.",
      whatItDoes:
        "Lets the gate and the hosts download built paths instead of compiling them. The gate pushes every host closure it builds from a same-repository PR.",
      howItsBuilt:
        "atticd on pewter with PostgreSQL, behind nginx with ACME for cache.mippbipp.com. The gate logs in with the ATTIC_CACHE_TOKEN secret. Attic removes shared paths server-side.",
      sources: [{ path: "hosts/pewter/attic.nix", commit: C }],
    },
    {
      id: "scope",
      code: "SC",
      name: "flake-update-scope",
      shape: "gate",
      group: "actions",
      status: "live",
      oneLiner: "Fails a flake-update PR whose diff touches a blocked path.",
      whatItDoes:
        "Stops the update PR from changing the pipeline's own workflows, secrets or code. On any other PR it passes without doing anything, so the required check always reports.",
      howItsBuilt:
        ".github/workflows/flake-update-scope.yml on pull_request_target, so GitHub runs main's copy of the file. It never checks out PR code. It lists the PR's changed files through the API, including a renamed file's old path, and reads blocked-paths.json from the base ref. The step runs only when the head ref is flake-update and the head repository is this one. Permissions are contents: read and pull-requests: read.",
      steps: [
        {
          name: "Guard",
          detail: "Skip unless the head ref is flake-update and the head repo is this repository.",
        },
        {
          name: "Read the list",
          detail: "Fetch blocked-paths.json from the base branch through the contents API.",
        },
        {
          name: "List changed files",
          detail: "Paginate the PR's files, taking filename and previous_filename.",
        },
        {
          name: "Match",
          detail: "Prefix, exact file or substring match with jq. Any match prints the paths and exits 1.",
        },
      ],
      sources: [{ path: ".github/workflows/flake-update-scope.yml", commit: C }],
    },
    {
      id: "blocked",
      code: "BL",
      name: "blocked-paths.json",
      shape: "document",
      group: "pewter",
      status: "live",
      oneLiner: "The one list of paths the Flake fixer may never change.",
      whatItDoes:
        "Prefixes .github/, secrets/ and hosts/pewter/flake-updater/. Files .sops.yaml and checks.nix. Substrings .git/, .opencode/ and opencode.json anywhere in a path. Three readers use it, so they cannot disagree.",
      howItsBuilt:
        "Read by src/scope.ts (isBlocked, used on every round), by opencode-config.nix (hard deny policies on the server), and by the scope workflow through the API. The Updater's session rules also pass the list to the agent.",
      sources: [
        { path: "hosts/pewter/flake-updater/blocked-paths.json", commit: C },
        { path: "hosts/pewter/flake-updater/src/scope.ts", commit: C },
        { path: "hosts/pewter/flake-updater/opencode-config.nix", commit: C },
      ],
    },
    {
      id: "ruleset",
      code: "RS",
      name: "Merge ruleset",
      shape: "gate",
      group: "repo",
      status: "live",
      oneLiner: "The GitHub ruleset that blocks merging to main until five checks pass.",
      whatItDoes:
        "Blocks the merge until checks aarch64-linux, checks x86_64-linux, build aarch64-linux, build x86_64-linux and flake-update-scope have all succeeded. It also forbids deleting main and force-pushing it. Repository admins can bypass it, so deliberate local work normally goes through a PR.",
      howItsBuilt:
        "Ruleset 'flake update' (id 21861651), active, targeting the default branch. Rules: deletion, non_fast_forward, required_status_checks (five contexts, all from the GitHub Actions app, id 15368; strict policy off). Bypass: repository role 5 (admin), always. The ruleset is control-plane state edited on GitHub; it is not in the repo or in terraform/. The Updater reads it per verdict through gh api repos/<repo>/rules/branches/main, and fails the run if it requires no checks. A new arch needs its build <system> added here by hand, and flake-update-scope was added by hand after its first run.",
      questions: [
        {
          id: "Q-RS1",
          state: "open",
          text: "The ruleset is edited by hand on GitHub and is not in terraform/ or anywhere in the repo, so would you like it managed as code like the other control-plane state?",
        },
        {
          id: "Q-RS2",
          state: "open",
          text: "Admin bypass is on with mode 'always'. ADR 0009 says it stays enabled knowingly, but is that still what you want now that the gate also guards the agent's changes?",
        },
      ],
      sources: [
        { path: "docs/adr/0009-flake-update-pipeline.md", commit: C },
        { path: "docs/agents/adding-a-host.md", commit: C },
        { path: "hosts/pewter/flake-updater/src/live/gate.ts", commit: C },
      ],
    },
    {
      id: "fixer",
      code: "F",
      name: "Flake fixer",
      shape: "box",
      group: "pewter",
      status: "live",
      oneLiner: "An opencode agent in a sandbox that fixes our config or asks for inputs to be held back.",
      whatItDoes:
        "Reads the trimmed failure, the lock diff and main's lock, then edits a copy of the repository. It either fixes configuration that uses renamed or removed upstream options, or lists inputs to put back at main's revision. It cannot commit, push, use the network or read secrets.",
      howItsBuilt:
        "Its own opencode serve on 127.0.0.1:4097 as system user flake-fixer, exposed on the tailnet at port 8444 with a password in a systemd credential. ProtectSystem=strict, ProtectHome, PrivateTmp, NoNewPrivileges, and /run/secrets, /var/lib/flake-updater and /var/lib/sops-nix are inaccessible. Config comes from a read-only XDG_CONFIG_HOME and project config is disabled. Policies deny web access, subagents, git, gh, curl, ssh, sudo, nix build/run/shell, --impure, edits to blocked paths, and every model provider except the pinned one. The default model is opencode/deepseek-v4.1-flash-free. It runs only inside an Updater run, and the services.flake-updater.agent.enable option is on for pewter.",
      steps: [
        {
          name: "Receive the workspace",
          detail:
            "The Updater copies HEAD into /var/lib/flake-fixer/work and writes main's flake.lock under context/.",
        },
        {
          name: "Diagnose",
          detail: "Read the trimmed Nix errors by job and host, the lock diff and upstream sources through read-only shell commands.",
        },
        {
          name: "Fix or hold back",
          detail:
            "Edit configuration, or list inputs for revert. Do not edit flake.lock; the Updater rebuilds it from the list.",
        },
        {
          name: "Evaluate",
          detail:
            "Evaluate every host's toplevel.drvPath and run nix flake check --no-build before finishing. Building is left to the gate.",
        },
        {
          name: "Report",
          detail:
            "Answer with JSON: outcome (fixed, reverted or gave-up), revertedInputs, filesChanged, summary.",
        },
      ],
      questions: [
        {
          id: "Q-F1",
          state: "open",
          text: "Issue #236 recorded 'Free usage limit reached' for the default free model, and ADR 0009 says it never falls back to a paid one, so do you want to keep the free model or pay for one?",
        },
      ],
      sources: [
        { path: "hosts/pewter/flake-updater/default.nix", commit: C },
        { path: "hosts/pewter/flake-updater/opencode-config.nix", commit: C },
        { path: "hosts/pewter/flake-updater/src/live/agent.ts", commit: C },
        { path: "hosts/pewter/flake-updater/src/agent.ts", commit: C },
      ],
    },
    {
      id: "issues",
      code: "IS",
      name: "Automated issues",
      shape: "document",
      group: "repo",
      status: "live",
      oneLiner: "One open issue per problem: repair failed, or an input held back.",
      whatItDoes:
        "Tells a person what the Updater could not finish. Later reports on the same subject become comments. 'flake-update: repair failed' means the gate stayed red or the fixer could not run. 'flake-update: <input> held back' names an input reverted to main's revision, with the failing hosts and the session.",
      howItsBuilt:
        "Created with gh issue create, labels needs-triage and automated, titles from src/branch-state.ts and src/issues.ts. A held-back issue carries an HTML comment marker with main's lock entry for the input, and the next run closes it once main's entry differs. A repair-failed issue closes when a later run sees a green gate. Rendering logic is in src/issues.ts.",
      sources: [
        { path: "hosts/pewter/flake-updater/src/issues.ts", commit: C },
        { path: "hosts/pewter/flake-updater/src/branch-state.ts", commit: C },
      ],
    },
    {
      id: "me",
      code: "ME",
      name: "Maintainer",
      shape: "person",
      group: "people",
      status: "live",
      oneLiner: "The person who reads fixer commits, issues and watchdog failures.",
      whatItDoes:
        "Merges by hand a PR carrying a Flake fixer code change, reads the fixer's session when something looks wrong, and acts on the watchdog's failure mail.",
      howItsBuilt:
        "The PR is labelled ready-for-human when review is needed. Sessions open at https://pewter.<tailnet>:8444 as user opencode, with the password from /var/lib/flake-updater/fixer-password.",
      questions: [
        {
          id: "Q-ME1",
          state: "open",
          text: "Nothing in the repo shows how GitHub notifies you about the automated issues or a failed watchdog run, so is that your account's notification settings?",
        },
      ],
    },
    {
      id: "wd",
      code: "W",
      name: "Watchdog",
      shape: "job",
      group: "actions",
      status: "live",
      oneLiner: "Fails monthly if flake.lock has not changed in 30 days.",
      whatItDoes:
        "Catches the case no other part can report, where the Updater has silently stopped (dead timer, expired credentials). A failed run is the alert.",
      howItsBuilt:
        ".github/workflows/watchdog.yml, workflow name update-watchdog, job 'recent flake update'. Cron 0 9 1 * * plus workflow_dispatch. It checks out full history, reads git log -1 --format=%ct -- flake.lock, and exits 1 above 30 days. Recent scheduled runs were 2026-08-31, 2026-10-01 and 2026-11-01, all success, started between about 15:43 and 16:40 UTC rather than at 09:00.",
      steps: [
        { name: "Check out", detail: "fetch-depth: 0, so the log has full history." },
        { name: "Read the age", detail: "Commit time of the newest commit that touched flake.lock." },
        { name: "Compare", detail: "More than 30 days prints the age and exits 1." },
      ],
      sources: [{ path: ".github/workflows/watchdog.yml", commit: C }],
    },
  ],

  hops: [
    {
      id: "h-fire",
      from: "timer",
      to: "updater",
      label: "start service",
      payload: {
        unit: "flake-updater.service",
        OnCalendar: "Mon *-*-* 02:00:00",
        Persistent: true,
        RandomizedDelaySec: "30m",
      },
    },
    {
      id: "h-lock-update",
      from: "updater",
      to: "inputs",
      label: "nix flake update",
      payload: { cmd: "nix flake update", cwd: "/var/lib/flake-updater" },
    },
    {
      id: "h-new-revs",
      from: "inputs",
      to: "updater",
      label: "newer revisions",
      payload: { file: "flake.lock", changed: "each input whose locked revision moved, with its own inputs" },
    },
    {
      id: "h-fetch-main",
      from: "main",
      to: "updater",
      label: "fetch origin",
      payload: { cmd: "git fetch --prune origin", ref: "origin/main", recurseSubmodules: false },
    },
    {
      id: "h-push-pr",
      from: "updater",
      to: "pr",
      label: "push, open PR",
      payload: {
        push: "HEAD:flake-update",
        flags: "--force-with-lease only when the branch started over",
        pr: { title: "up", labels: ["dependencies", "automated"] },
        autoMerge: "squash",
      },
    },
    {
      id: "h-trigger",
      from: "pr",
      to: "bg",
      label: "pull_request",
      payload: { event: "pull_request", head: "flake-update", base: "main", concurrency: "build-gate-235" },
    },
    {
      id: "h-substitute",
      from: "attic",
      to: "bg",
      label: "substitute paths",
      payload: { substituter: "https://cache.mippbipp.com/fleet", result: "narinfo hit, no rebuild" },
    },
    {
      id: "h-attic-push",
      from: "bg",
      to: "attic",
      label: "push closures",
      payload: { cmd: "attic push cache:fleet result-gram", onlyWhen: "PR head repo is this repo" },
    },
    {
      id: "h-bg-checks",
      from: "bg",
      to: "pr",
      label: "check runs",
      payload: {
        "build x86_64-linux": "success",
        "build aarch64-linux": "success",
        "checks x86_64-linux": "success",
        "checks aarch64-linux": "success",
      },
    },
    {
      id: "h-scope-trigger",
      from: "pr",
      to: "scope",
      label: "pull_request_target",
      payload: { event: "pull_request_target", action: "synchronize", "head.ref": "flake-update" },
    },
    {
      id: "h-blocked-read",
      from: "blocked",
      to: "scope",
      label: "list from base ref",
      payload: {
        GET: "repos/mippbipp/conf.nix/contents/hosts/pewter/flake-updater/blocked-paths.json?ref=main",
        prefixes: [".github/", "secrets/", "hosts/pewter/flake-updater/"],
        files: [".sops.yaml", "checks.nix"],
        substrings: [".git/", ".opencode/", "opencode.json"],
      },
    },
    {
      id: "h-scope-check",
      from: "scope",
      to: "pr",
      label: "scope result",
      payload: { "flake-update-scope": "success", log: "no blocked paths changed" },
    },
    {
      id: "h-pr-ruleset",
      from: "pr",
      to: "ruleset",
      label: "checks on head",
      payload: { required: required, onHeadCommit: "all success", strict_required_status_checks_policy: false },
    },
    {
      id: "h-merge",
      from: "ruleset",
      to: "main",
      label: "allow squash merge",
      payload: { method: "squash", commits: 1, trigger: "auto-merge once the five required checks pass" },
    },
    {
      id: "h-rules",
      from: "ruleset",
      to: "updater",
      label: "required checks",
      payload: {
        GET: "repos/mippbipp/conf.nix/rules/branches/main",
        required_status_checks: required,
      },
    },
    {
      id: "h-rollup",
      from: "pr",
      to: "updater",
      label: "rollup and logs",
      payload: {
        headRefOid: "pushed commit sha",
        statusCheckRollup: [
          { name: "build x86_64-linux", status: "COMPLETED", conclusion: "FAILURE" },
          { name: "build aarch64-linux", status: "COMPLETED", conclusion: "SUCCESS" },
        ],
        failedLog: "gh run view <run> --job <job> --log-failed",
      },
    },
    {
      id: "h-prompt",
      from: "updater",
      to: "fixer",
      label: "prompt with errors",
      payload: {
        session: "new in round 1, continued after",
        title: "flake-update #235",
        round: 1,
        failures: "## build x86_64-linux\n### build x86_64-linux (gram)\nerror: ...",
        changes: "<input> <old rev>→<new rev>, one line per changed input",
        mainLock: "context/main.flake.lock",
      },
    },
    {
      id: "h-block-fixer",
      from: "blocked",
      to: "fixer",
      label: "edit policies",
      payload: {
        deny: ["edit:.github/*", "edit:secrets/*", "edit:hosts/pewter/flake-updater/*", "edit:.sops.yaml", "edit:checks.nix", "edit:*.git/*"],
        source: "opencode-config.nix and the Updater's session rules",
      },
    },
    {
      id: "h-report",
      from: "fixer",
      to: "updater",
      label: "JSON report",
      payload: {
        outcome: "fixed",
        revertedInputs: [],
        filesChanged: ["modules/system/config/common.nix"],
        summary: "Drop removed boot.initrd options",
      },
    },
    {
      id: "h-block-up",
      from: "blocked",
      to: "updater",
      label: "isBlocked() check",
      payload: {
        importedFiles: ["modules/system/config/common.nix", "flake.lock"],
        blocked: [],
        gitlinks: [],
        decision: "keep the round; any hit discards it and tells the agent why",
      },
    },
    {
      id: "h-fix-push",
      from: "updater",
      to: "pr",
      label: "commit and push",
      payload: {
        author: "flake-fixer",
        subject: "flake-fixer: Drop removed boot.initrd options",
        trailers: {
          "Flake-Fixer-Round": "1",
          "Flake-Fixer-Session": "ses_...",
          "Flake-Fixer-Review": "required",
        },
        autoMerge: "off",
        label: "ready-for-human",
      },
    },
    {
      id: "h-issue",
      from: "updater",
      to: "issues",
      label: "open or comment",
      payload: {
        title: "flake-update: repair failed",
        labels: ["needs-triage", "automated"],
        reason: "the Flake fixer could not run: Free usage limit reached",
      },
    },
    {
      id: "h-notify",
      from: "issues",
      to: "me",
      label: "notification",
      payload: { to: "mippbipp", via: "GitHub notifications (settings not in the repo)" },
    },
    {
      id: "h-review",
      from: "me",
      to: "pr",
      label: "review, merge by hand",
      payload: { read: "the flake-fixer commit", then: "gh pr merge 235 --squash" },
    },
    {
      id: "h-session",
      from: "me",
      to: "fixer",
      label: "open session",
      payload: {
        url: "https://pewter.<tailnet>:8444",
        user: "opencode",
        password: "/var/lib/flake-updater/fixer-password",
      },
    },
    {
      id: "h-wd-read",
      from: "main",
      to: "wd",
      label: "newest flake.lock commit",
      payload: { cmd: "git log -1 --format=%ct -- flake.lock", checkout: "fetch-depth 0" },
    },
    {
      id: "h-wd-alert",
      from: "wd",
      to: "me",
      label: "failed run",
      payload: { workflow: "update-watchdog", conclusion: "failure", stderr: "flake.lock has not changed in <N> days" },
    },
  ],

  flows: [
    {
      id: "f-green",
      name: "A green week",
      hops: [
        "h-fire",
        "h-fetch-main",
        "h-lock-update",
        "h-new-revs",
        "h-push-pr",
        "h-trigger",
        "h-substitute",
        "h-attic-push",
        "h-bg-checks",
        "h-scope-trigger",
        "h-blocked-read",
        "h-scope-check",
        "h-pr-ruleset",
        "h-merge",
      ],
    },
    {
      id: "f-fixed",
      name: "A red week the fixer repairs",
      hops: [
        "h-push-pr",
        "h-trigger",
        "h-bg-checks",
        "h-rules",
        "h-rollup",
        "h-prompt",
        "h-block-fixer",
        "h-report",
        "h-block-up",
        "h-fix-push",
        "h-review",
        "h-merge",
      ],
    },
    {
      id: "f-failed",
      name: "A red week nobody fixes",
      hops: ["h-rollup", "h-prompt", "h-report", "h-issue", "h-notify", "h-session"],
    },
    {
      id: "f-silent",
      name: "The Updater goes quiet",
      hops: ["h-wd-read", "h-wd-alert"],
    },
  ],

  chapters: [
    {
      id: "c-monday",
      title: "Monday on pewter",
      lede: "A timer starts the Updater, which asks upstream for newer revisions.",
      story:
        "Nothing about the update happens on GitHub yet. A systemd timer on pewter fires around 02:00 and runs the Updater, which runs nix flake update against the 21 flakes in flake.lock. The only file that should change is flake.lock.",
      reveals: ["timer", "updater", "inputs"],
      plays: ["h-fire", "h-lock-update", "h-new-revs"],
    },
    {
      id: "c-branch",
      title: "One branch, one PR",
      lede: "The Updater keeps a single flake-update branch and pull request against main.",
      story:
        "Last week's PR may still be open, so the Updater merges main into its branch instead of starting over. Only a conflict outside flake.lock makes it drop the old commits. The PR body is rebuilt from the branch each run, which is why a run that died halfway costs nothing.",
      reveals: ["main", "pr"],
      plays: ["h-fetch-main", "h-push-pr"],
    },
    {
      id: "c-gate",
      title: "The Build gate",
      lede: "Two jobs build every host, one per architecture, and share a store.",
      story:
        "ADR 0018 moved from a job per host to a job per arch, so a derivation shared by same-arch hosts compiles once. The job lists its hosts from the flake, so a new host of a covered arch needs no workflow edit. A failing host shows up as a 'build <host>' section in the arch job's log.",
      reveals: ["bg", "attic"],
      plays: ["h-trigger", "h-substitute", "h-attic-push", "h-bg-checks"],
    },
    {
      id: "c-scope",
      title: "Scope and merge",
      lede: "A scope check and the ruleset on main decide whether GitHub may merge.",
      story:
        "flake-update-scope runs main's copy of the workflow, so the PR cannot weaken the check that guards it. The ruleset then needs all five checks green on the head commit before auto-merge squashes the PR into main. The ruleset itself is edited by hand on GitHub.",
      reveals: ["scope", "blocked", "ruleset"],
      plays: ["h-scope-trigger", "h-blocked-read", "h-scope-check", "h-pr-ruleset", "h-merge"],
    },
    {
      id: "c-red",
      title: "When the gate is red",
      lede: "The Updater hands the trimmed failure to the Flake fixer and takes back a report.",
      story:
        "The Updater polls until every required check is on the pushed commit and every check has finished. It trims the failed logs to Nix error blocks and sends them with the lock diff. The fixer works in a sandbox and cannot push, so the Updater checks the result against blocked-paths.json, rebuilds flake.lock itself and commits as flake-fixer. Any code change turns auto-merge off.",
      reveals: ["fixer"],
      plays: ["h-rules", "h-rollup", "h-prompt", "h-block-fixer", "h-report", "h-block-up", "h-fix-push"],
    },
    {
      id: "c-person",
      title: "Telling a person",
      lede: "When repair stops or a code change needs reading, the Updater raises an issue or leaves the PR for you.",
      story:
        "Repair stops after three rounds, when the fixer gives up or cannot run, when a check outside the gate fails, or at 11.5 hours. The Updater opens one issue per subject and comments on it later. A PR with a fixer code change keeps the ready-for-human label until you merge it.",
      reveals: ["issues", "me"],
      plays: ["h-issue", "h-notify", "h-review", "h-session"],
    },
    {
      id: "c-watchdog",
      title: "The watchdog",
      lede: "A monthly job fails if main's flake.lock has gone stale.",
      story:
        "Every other alert needs the Updater to be running. The watchdog reads the age of the last commit touching flake.lock and fails above 30 days, which is how a dead timer or expired token gets noticed.",
      reveals: ["wd"],
      plays: ["h-wd-read", "h-wd-alert"],
    },
    {
      id: "c-whole",
      title: "The whole pipeline",
      lede: "Fourteen structures keep main buildable while the lock moves every week.",
      story:
        "The timer starts the Updater, the Updater keeps one PR, the Build gate and the scope check judge it, and the ruleset decides the merge. When the gate is red a sandboxed agent tries to fix it and a person reads anything beyond a revert. When nothing runs for 30 days the watchdog fails. Pick a flow to replay one story.",
      reveals: [],
      plays: [],
    },
  ],
};
