// The flake update pipeline in mippbipp/conf.nix, written from ADR 0009,
// ADR 0018, hosts/pewter/flake-updater/ and the three workflows on
// 2026-10-31. Positions live in layout.json.

const adr0009 = "adr/0009-flake-update-pipeline.md";
const adr0018 = "adr/0018-per-arch-build-gate.md";
const adrDate = "2026-10-29";

export default {
  format: 1,
  revision: 0,

  overview: {
    title: "Flake update pipeline",
    summary: `Every Monday around 02:00 the Updater on pewter runs nix flake update on the flake-update branch and keeps one pull request open for it. GitHub Actions builds every host's closure, one job per arch, and runs the flake checks. Main's ruleset lets the PR merge only when all five required checks pass, so main always builds for every NixOS host. When the gate is red, the Flake fixer (an opencode agent, currently switched off on pewter) can fix our config or hold an input back, for at most three rounds. A monthly Watchdog fails, and so emails, if flake.lock hasn't moved on main for 30 days.`,
    stats: [
      { label: "Schedule", value: "Mon 02:00 + up to 30 min" },
      { label: "Required checks", value: "5" },
      { label: "Repair rounds", value: "3 at most" },
      { label: "Repair deadline", value: "11.5 h (unit limit 12 h)" },
      { label: "Workflows", value: "3" },
    ],
    decisions: [
      {
        topic: "Verify before merge",
        decision:
          "Main must build for every NixOS host, so a lock bump merges only after the Build gate passes on free GitHub runners for both arches.",
        adr: adr0009,
      },
      {
        topic: "Orchestrator on pewter",
        decision:
          "The Updater runs on pewter because it's always on and already authenticated to GitHub; Actions has the free x86_64 and aarch64 builders.",
        adr: adr0009,
      },
      {
        topic: "Agent, not auto-revert",
        decision:
          "Most red weeks are our config's fault (PR #232), so an agent reads the log and either fixes config or holds an input back.",
        adr: adr0009,
      },
      {
        topic: "Agent never commits",
        decision:
          "The Flake fixer runs as its own sandboxed user with no credentials; the Updater commits and pushes for it.",
        adr: adr0009,
      },
      {
        topic: "One gate job per arch",
        decision:
          "Each arch job builds all its hosts in one /nix/store so shared derivations compile once; host failures show as build <host> log groups.",
        adr: adr0018,
      },
    ],
    fileLayout: `docs/adr/
  0009-flake-update-pipeline.md   design and runbook
  0018-per-arch-build-gate.md     why one gate job per arch
hosts/pewter/
  config.nix                      imports ./flake-updater
  attic.nix                       the Attic cache server
  flake-updater/
    default.nix                   units, timer, fixer server and sandbox
    opencode-config.nix           the fixer's hard-deny policies
    blocked-paths.json            paths the fixer may never change
    src/updater.ts                the weekly run and repair loop
    src/repair-round.ts           one Flake fixer round
    src/gate.ts, live/gate.ts     waiting for the gate verdict
    src/branch-state.ts           trailers, held-back state
    src/issues.ts, pr-body.ts     issue and PR text
    src/scope.ts                  isBlocked
.github/workflows/
  build-gate.yml                  build <system> and checks <system>
  flake-update-scope.yml          blocked-path check on pull_request_target
  watchdog.yml                    monthly stale-lock check`,
    platformProvides: `GitHub provides free x86_64 and aarch64 runners for public repos, pull requests, squash auto-merge, rulesets with required checks, and issue emails. NixOS provides systemd timers, sandboxing and credentials. opencode provides the agent server and its policy engine. Attic dedups store paths server-side.`,
    weOwn: `The Updater program (TypeScript and Effect, with its own tests run in the package's check phase), the gate workflows and their per-arch host enumeration, the blocked-paths list and the three places that read it, the fixer's sandbox and policies, and the issue and PR text.`,
  },

  groups: [
    { id: "pewter", title: "pewter (aarch64 VM)" },
    { id: "actions", title: "GitHub Actions" },
    { id: "repo", title: "GitHub repo mippbipp/conf.nix" },
    { id: "outside", title: "Outside" },
  ],

  structures: [
    {
      id: "updater",
      code: "U",
      name: "Updater",
      tag: "flake-updater",
      shape: "tall",
      group: "pewter",
      status: "live",
      oneLiner:
        "Bumps the flake inputs every Monday and keeps one verified update PR open.",
      whatItDoes:
        "Once a week it brings the flake-update branch up to date with main, runs nix flake update, pushes, and writes the PR body from what the branch holds. It asks GitHub for squash auto-merge unless a Flake fixer commit needs a person. With the Flake fixer switched on, it also waits for the gate and runs repair rounds while the gate is red.",
      howItsBuilt:
        "flake-updater.timer (OnCalendar Mon 02:00, Persistent, RandomizedDelaySec 30m) starts the oneshot flake-updater.service in hosts/pewter/flake-updater/default.nix, with TimeoutStartSec 12h. The program is TypeScript and Effect: src/main.ts parses flags, src/updater.ts runs the steps, live/git.ts and live/github.ts shell out to git and gh. It runs as the pewter user, keeps its clone in /var/lib/flake-updater (mode 0700), and reads the token from the SOPS secret github_token. Git runs with hooks off and gh's credential helper in the clone's own .git config.",
      steps: [
        {
          name: "Fetch",
          detail:
            "Fetches origin without submodules, since the submodule URL is SSH and the service uses HTTPS with the token.",
        },
        {
          name: "Rebuild the branch",
          detail:
            "With an open PR it checks out origin/flake-update and merges origin/main. A conflict only in flake.lock takes main's copy; any other conflict logs the dropped SHAs and starts over from main. Without a PR it starts over from main.",
        },
        {
          name: "Update the lock",
          detail:
            "Runs nix flake update and commits flake.lock if it changed. Inputs held back last week get retried here.",
        },
        {
          name: "Stop if nothing changed",
          detail:
            "Exits successfully when the branch no longer differs from main.",
        },
        {
          name: "Push",
          detail:
            "A continued branch fast-forwards. A branch that started over is pushed with --force-with-lease.",
        },
        {
          name: "Write the PR",
          detail:
            "Opens the PR if absent (labels dependencies and automated), regenerates its body, and requests squash auto-merge unless a fixer commit needs review.",
        },
      ],
      questions: [
        {
          id: "Q-U1",
          state: "open",
          text: "With the Flake fixer off, a red gate opens no issue, so who notices before the Watchdog does?",
        },
        {
          id: "Q-U2",
          state: "open",
          text: "Can three rounds fit in 11.5 hours when each build job may run for up to 350 minutes?",
        },
        {
          id: "Q-U3",
          state: "resolved",
          text: "Why does the Updater commit and push for the agent instead of letting it push?",
          answer:
            "Letting the agent push would put push credentials and a writable .git in its reach, so the Updater commits and pushes.",
          answeredBy: "ADR 0009",
          answeredOn: adrDate,
        },
      ],
    },
    {
      id: "fixer",
      code: "FX",
      name: "Flake fixer",
      tag: "flake-fixer",
      shape: "box",
      group: "pewter",
      status: "off",
      oneLiner:
        "An opencode agent that repairs a red gate by fixing our config or holding inputs back.",
      whatItDoes:
        "When the gate fails, the Updater sends it the trimmed Nix errors and the lock diff. It edits a copy of the branch to fix options upstream renamed or removed, or names inputs to keep at main's revision, then replies with a JSON report. It must evaluate every host's toplevel.drvPath and run nix flake check --no-build first. It can't build, browse, run git or push.",
      howItsBuilt:
        "flake-fixer.service runs opencode serve on 127.0.0.1:4097 as the flake-fixer system user, only when services.flake-updater.agent.enable is true. pewter's config.nix doesn't set it, so the server isn't built. Its config is opencode-config.nix in a read-only XDG_CONFIG_HOME, with project config off. The sandbox has ProtectSystem=strict, ProtectHome, no capabilities, and /run/secrets, /var/lib/flake-updater and /var/lib/sops-nix inaccessible. flake-fixer-password.service creates the web UI password, which tailnetExpose serves on port 8444. The model defaults to opencode/deepseek-v4.1-flash-free, and every other provider is denied.",
      steps: [
        {
          name: "Check the failures",
          detail:
            "Every failed check must be a build <system> or checks <system> job. Anything else, such as flake-update-scope, stops the repair.",
        },
        {
          name: "Trim the logs",
          detail:
            "Cuts each failed job's gh run view --log-failed output to its Nix error blocks, grouped by job and build <host> section.",
        },
        {
          name: "Fill the workspace",
          detail:
            "Copies the branch's tree into /var/lib/flake-fixer/work and main's flake.lock into /var/lib/flake-fixer/context.",
        },
        {
          name: "Prompt the agent",
          detail:
            "Round 1 opens a session titled flake-update #<pr>; later rounds continue it and say why the last round was discarded.",
        },
        {
          name: "Ask for the report",
          detail:
            "Asks for JSON: outcome, revertedInputs, filesChanged and a one-line summary.",
        },
        {
          name: "Rebuild flake.lock",
          detail:
            "Resets each held-back input to main's node and keeps the rest of the update. The agent's own lock edits are ignored.",
        },
        {
          name: "Discard if needed",
          detail:
            "Drops the round if it changed nothing, touched a blocked path, added a gitlink, or reported files that differ from what changed.",
        },
        {
          name: "Commit and push",
          detail:
            "Commits as author flake-fixer with Flake-Fixer-Round, -Session, -Review and -Reverted trailers, turns auto-merge off when review is needed, then pushes.",
        },
        {
          name: "File held-back issues",
          detail:
            "Opens or comments on one flake-update: <input> held back issue per held-back input.",
        },
      ],
      questions: [
        {
          id: "Q-FX1",
          state: "open",
          text: "When will services.flake-updater.agent.enable be set on pewter, and what has to happen first?",
        },
        {
          id: "Q-FX2",
          state: "open",
          text: "The agent runs inside the server that holds OPENCODE_SERVER_PASSWORD, so can it read the web UI password from its own environment?",
        },
        {
          id: "Q-FX3",
          state: "resolved",
          text: "Does the fixer switch to a paid model when the free model's daily quota runs out?",
          answer:
            "No. The run opens flake-update: repair failed naming the model, and switching models is a config change.",
          answeredBy: "ADR 0009",
          answeredOn: adrDate,
        },
      ],
    },
    {
      id: "workspace",
      code: "W",
      name: "Fixer workspace and context",
      tag: "workspace",
      shape: "store",
      group: "pewter",
      status: "off",
      oneLiner:
        "The copy of the branch the agent edits, plus main's flake.lock for reference.",
      whatItDoes:
        "Holds a plain copy of the branch's files, with no .git, for the agent to edit. A second folder holds main's flake.lock so the agent can compare revisions. The Updater reads the edited files back and keeps only what passes its checks.",
      howItsBuilt:
        "/var/lib/flake-fixer/work and /var/lib/flake-fixer/context, created by tmpfiles as mode 2770 owned by flake-fixer, with the pewter user in the group. Dry runs use dry-work and dry-context instead. The Updater imports the tree through its own .git with a separate index file (flake-fixer-index), so git never runs inside a folder the agent can write.",
      questions: [
        {
          id: "Q-W1",
          state: "resolved",
          text: "Could the agent plant a git hook or config in the workspace that the Updater then runs?",
          answer:
            "No. The Updater reads the workspace through its own .git with a separate index, and discards any round that adds or moves a gitlink.",
          answeredBy: "ADR 0009",
          answeredOn: adrDate,
        },
      ],
    },
    {
      id: "attic",
      code: "A",
      name: "Attic cache",
      tag: "cache:fleet",
      shape: "store",
      group: "pewter",
      status: "live",
      oneLiner:
        "The fleet's binary cache, which the gate pulls from and pushes to.",
      whatItDoes:
        "Gate jobs fetch already-built store paths from it instead of compiling them. After a successful build on a PR from this repo, the build job pushes each host's closure, and Attic keeps only one copy of paths that hosts share.",
      howItsBuilt:
        "atticd in hosts/pewter/attic.nix, listening on 127.0.0.1:8080 behind https://cache.mippbipp.com, with PostgreSQL and local storage. Garbage collection runs every 12 hours with 30 days' retention. The workflow logs in with the ATTIC_CACHE_TOKEN secret and runs attic push cache:fleet result-<host>.",
    },
    {
      id: "build",
      code: "B",
      name: "Build gate build jobs",
      tag: "build <system>",
      shape: "job",
      group: "actions",
      status: "live",
      oneLiner:
        "Builds every host's full system closure, one job per arch.",
      whatItDoes:
        "For each arch it lists the hosts of that arch from the flake and builds each one's toplevel in turn, in one /nix/store, so shared derivations compile once. One broken host doesn't stop the others. Each host's output sits in its own build <host> log group.",
      howItsBuilt:
        "The build-closure job in .github/workflows/build-gate.yml, triggered on pull_request. Its matrix has x86_64-linux on ubuntu-latest and aarch64-linux on ubuntu-24.04-arm, with a 350-minute timeout and cancel-in-progress per PR. Hosts come from nix eval of nixosConfigurations filtered by config.nixpkgs.hostPlatform.system. Nix comes from DeterminateSystems/determinate-nix-action@main.",
      questions: [
        {
          id: "Q-B1",
          state: "open",
          text: "Should determinate-nix-action be pinned to a commit instead of @main, since it runs with the Attic token in reach?",
        },
        {
          id: "Q-B2",
          state: "resolved",
          text: "Why one job per arch instead of one per host?",
          answer:
            "Separate jobs have separate stores, so two hosts of one arch would both compile a shared derivation such as the CachyOS kernel.",
          answeredBy: "ADR 0018",
          answeredOn: adrDate,
        },
      ],
    },
    {
      id: "checks",
      code: "C",
      name: "Build gate checks jobs",
      tag: "checks <system>",
      shape: "job",
      group: "actions",
      status: "live",
      oneLiner: "Builds every flake check for each arch.",
      whatItDoes:
        "Runs the flake's checks, such as build-matrix-sync, which fails when the gate's matrix rows and the hosts drift apart, and the registry and profile checks.",
      howItsBuilt:
        "The checks job in .github/workflows/build-gate.yml, same matrix as the build jobs, 60-minute timeout. It lists checks.<system> with nix eval --apply builtins.attrNames and builds each. Checks are defined in checks.nix, a blocked path for the fixer.",
    },
    {
      id: "scope",
      code: "S",
      name: "flake-update-scope",
      shape: "gate",
      group: "actions",
      status: "live",
      oneLiner:
        "Fails a flake-update PR whose diff touches a blocked path.",
      whatItDoes:
        "Lists the PR's changed files, counting a rename's old path too, and fails if any is blocked. It runs main's copy of the workflow, so a commit on the PR can't weaken it. On other PRs the step is skipped and the check passes.",
      howItsBuilt:
        ".github/workflows/flake-update-scope.yml on pull_request_target (opened, synchronize, reopened), with read-only contents and pull-requests permissions. It never checks out PR code. It reads blocked-paths.json from the base branch through the contents API and matches with jq.",
      questions: [
        {
          id: "Q-S1",
          state: "open",
          text: "A failing scope check stops the repair, so should it also open an issue that names the blocked path?",
        },
      ],
    },
    {
      id: "watchdog",
      code: "WD",
      name: "Watchdog",
      tag: "update-watchdog",
      shape: "job",
      group: "actions",
      status: "live",
      oneLiner:
        "Fails every month when flake.lock on main is over 30 days old.",
      whatItDoes:
        "Catches the Updater dying quietly, such as an expired token or a dead timer, where nothing else would complain. A failed run emails the maintainer.",
      howItsBuilt:
        ".github/workflows/watchdog.yml, job recent flake update, cron 0 9 1 * * plus workflow_dispatch. It reads git log -1 --format=%ct -- flake.lock and exits 1 past 30 days.",
      questions: [
        {
          id: "Q-WD1",
          state: "open",
          text: "Running only on the 1st means a lock that goes stale on the 2nd is caught about 59 days after its last update; is that slow enough to matter?",
        },
      ],
    },
    {
      id: "pr",
      code: "PR",
      name: "flake-update branch and PR",
      tag: "flake-update PR",
      shape: "document",
      group: "repo",
      status: "live",
      oneLiner:
        "The single PR that collects each week's lock bump and any fixer commits.",
      whatItDoes:
        "One long-lived branch and one open PR. If last week's PR is still open, this week's run adds to it, so a fix waiting on review survives. Its body lists updated inputs, held-back inputs and fixer commits, and says when it needs review.",
      howItsBuilt:
        "Branch flake-update, PR into main titled up, labels dependencies and automated. The body comes from src/pr-body.ts and is rebuilt from the branch on every run. src/branch-state.ts reads the Flake-Fixer-* trailers to tell which commits need review. A PR that needs review gets the ready-for-human label and loses auto-merge.",
    },
    {
      id: "ruleset",
      code: "R",
      name: "Main ruleset",
      tag: "ruleset: main",
      shape: "gate",
      group: "repo",
      status: "live",
      oneLiner:
        "Lets a PR merge into main only when all five required checks pass.",
      whatItDoes:
        "Requires checks aarch64-linux, checks x86_64-linux, build aarch64-linux, build x86_64-linux and flake-update-scope. It blocks deleting main and non-fast-forward pushes. The Updater also reads it to learn which checks make up the gate.",
      howItsBuilt:
        "A GitHub ruleset on main, kept in GitHub's settings, not in the repo. The Updater reads it with gh api repos/<repo>/rules/branches/main on every verdict and fails the run if it lists no required checks. A new arch needs its build <system> added here by hand.",
      questions: [
        {
          id: "Q-R1",
          state: "open",
          text: "Is admin bypass on, and if so, can a direct push to main skip the gate?",
        },
        {
          id: "Q-R2",
          state: "open",
          text: "The ruleset lives outside the repo, so what catches it drifting from the workflow's check names?",
        },
      ],
    },
    {
      id: "blocked",
      code: "BP",
      name: "blocked-paths.json",
      shape: "document",
      group: "repo",
      status: "live",
      oneLiner: "The one list of paths the Flake fixer may never change.",
      whatItDoes:
        "Blocks .github/, secrets/ and hosts/pewter/flake-updater/ as prefixes, .sops.yaml and checks.nix as files, and .git/, .opencode/ and opencode.json anywhere in a path. Three places read it: the Updater, the fixer's opencode policies and the flake-update-scope workflow.",
      howItsBuilt:
        "hosts/pewter/flake-updater/blocked-paths.json with prefixes, files and substrings arrays. src/scope.ts imports it for isBlocked, opencode-config.nix turns it into edit: deny rules, and the workflow fetches main's copy through the API.",
      questions: [
        {
          id: "Q-BP1",
          state: "open",
          text: "Should flake.nix be blocked, since an agent edit there can repoint an input's URL?",
        },
      ],
    },
    {
      id: "issues",
      code: "I",
      name: "Automated issues",
      tag: "automated issues",
      shape: "cards",
      group: "repo",
      status: "live",
      oneLiner:
        "One issue per held-back input, and one for a failed repair.",
      whatItDoes:
        "flake-update: <input> held back says why an input was kept at main's revision and closes itself once main's lock entry for it changes. flake-update: repair failed says why the fixer stopped and closes when the gate goes green. A later report on the same subject becomes a comment.",
      howItsBuilt:
        "Text from src/issues.ts. The Updater files them with gh issue create, labels needs-triage and automated. A held-back issue carries a hidden marker with main's lock entry fingerprint from src/branch-state.ts.",
    },
    {
      id: "main",
      code: "MN",
      name: "main",
      shape: "slab",
      group: "repo",
      status: "live",
      oneLiner: "The branch every host deploys from. It must always build.",
      whatItDoes:
        "Receives each week's update as one squash commit. pewter's own rebuild happens after the merge, because activation can only be tested by deploying.",
      howItsBuilt:
        "The main branch of mippbipp/conf.nix, guarded by the main ruleset. The Updater merges origin/main into flake-update each run and reads main's flake.lock for held-back reverts.",
    },
    {
      id: "upstream",
      code: "UP",
      name: "Upstream flake inputs",
      shape: "external",
      group: "outside",
      status: "live",
      oneLiner: "nixpkgs and the other inputs flake.lock pins.",
      whatItDoes:
        "New revisions come from here. Most inputs follow nixpkgs, so reverting nixpkgs alone tests the rest against the old one anyway.",
      howItsBuilt:
        "The inputs in flake.nix, read by nix flake update on pewter. The gate pulls substitutes from cache.mippbipp.com/fleet and several Cachix caches listed in build-gate.yml.",
    },
    {
      id: "maintainer",
      code: "M",
      name: "Maintainer",
      shape: "person",
      group: "outside",
      status: "live",
      oneLiner:
        "Reviews fixer code changes, reads issues and acts on Watchdog emails.",
      whatItDoes:
        "Merges by hand any PR labelled ready-for-human after reading the fixer's commit. Follows the evidence order in ADR 0009 when an update fails, and can read a fixer session from any tailnet device.",
      howItsBuilt:
        "GitHub notifications and Actions failure emails. The fixer's web UI is at https://pewter.<tailnet>:8444, user opencode.",
    },
  ],

  hops: [
    {
      id: "h-main-updater",
      from: "main",
      to: "updater",
      label: "merge origin/main",
      payload: {
        mode: "continued",
        log: "continuing the open PR with main merged in",
      },
    },
    {
      id: "h-upstream-updater",
      from: "upstream",
      to: "updater",
      label: "nix flake update",
      payload: {
        nixpkgs: "a1b2c3d → e4f5a6b",
        "home-manager": "0c9d8e7 → 1f2e3d4",
      },
    },
    {
      id: "h-updater-pr",
      from: "updater",
      to: "pr",
      label: "push, write PR body",
      payload: {
        branch: "flake-update",
        push: "fast-forward",
        body: "Automated flake input update from the Updater on pewter.\n\n## Updated inputs\n\n- `nixpkgs` a1b2c3d → e4f5a6b\n- `home-manager` 0c9d8e7 → 1f2e3d4",
        autoMerge: "squash",
      },
    },
    {
      id: "h-pr-build",
      from: "pr",
      to: "build",
      label: "pull_request",
      payload: {
        workflow: "build-gate",
        jobs: ["build x86_64-linux", "build aarch64-linux"],
      },
    },
    {
      id: "h-attic-build",
      from: "attic",
      to: "build",
      label: "substitute paths",
      payload: { substituter: "https://cache.mippbipp.com/fleet" },
    },
    {
      id: "h-build-attic",
      from: "build",
      to: "attic",
      label: "attic push closures",
      payload: {
        command: "attic push cache:fleet result-pewter",
        when: "same-repo PR",
      },
    },
    {
      id: "h-pr-checks",
      from: "pr",
      to: "checks",
      label: "pull_request",
      payload: {
        jobs: ["checks x86_64-linux", "checks aarch64-linux"],
        includes: ["build-matrix-sync", "work-identity-wiring"],
      },
    },
    {
      id: "h-pr-scope",
      from: "pr",
      to: "scope",
      label: "pull_request_target",
      payload: {
        head: "flake-update",
        files: ["flake.lock", "modules/system/boot.nix"],
      },
    },
    {
      id: "h-blocked-scope",
      from: "blocked",
      to: "scope",
      label: "main's copy via API",
      payload: {
        prefixes: [".github/", "secrets/", "hosts/pewter/flake-updater/"],
        files: [".sops.yaml", "checks.nix"],
        substrings: [".git/", ".opencode/", "opencode.json"],
      },
    },
    {
      id: "h-build-ruleset",
      from: "build",
      to: "ruleset",
      label: "build <system> result",
      payload: { "build x86_64-linux": "success", "build aarch64-linux": "success" },
    },
    {
      id: "h-checks-ruleset",
      from: "checks",
      to: "ruleset",
      label: "checks <system> result",
      payload: { "checks x86_64-linux": "success", "checks aarch64-linux": "success" },
    },
    {
      id: "h-scope-ruleset",
      from: "scope",
      to: "ruleset",
      label: "scope result",
      payload: { "flake-update-scope": "success", log: "no blocked paths changed" },
    },
    {
      id: "h-ruleset-main",
      from: "ruleset",
      to: "main",
      label: "squash auto-merge",
      payload: { pr: 241, method: "squash", requiredChecks: "5 of 5 passed" },
    },
    {
      id: "h-ruleset-updater",
      from: "ruleset",
      to: "updater",
      label: "gate verdict",
      payload: {
        required: [
          "checks aarch64-linux",
          "checks x86_64-linux",
          "build aarch64-linux",
          "build x86_64-linux",
          "flake-update-scope",
        ],
        failed: [
          {
            name: "build x86_64-linux",
            url: "https://github.com/mippbipp/conf.nix/actions/runs/123/job/456",
          },
        ],
      },
    },
    {
      id: "h-updater-workspace",
      from: "updater",
      to: "workspace",
      label: "export tree, main's lock",
      payload: {
        work: "/var/lib/flake-fixer/work",
        context: "/var/lib/flake-fixer/context/flake.lock",
      },
    },
    {
      id: "h-updater-fixer",
      from: "updater",
      to: "fixer",
      label: "prompt: trimmed errors",
      payload: {
        session: "flake-update #241",
        round: 1,
        failures:
          "## build x86_64-linux\nerror: The option `boot.initrd.verbose' does not exist.",
        changes: "nixpkgs a1b2c3d→e4f5a6b",
      },
    },
    {
      id: "h-blocked-fixer",
      from: "blocked",
      to: "fixer",
      label: "edit: deny policies",
      payload: ["edit:.github/*", "edit:secrets/*", "edit:checks.nix", "edit:*.git/*"],
    },
    {
      id: "h-fixer-workspace",
      from: "fixer",
      to: "workspace",
      label: "edit config",
      payload: {
        file: "modules/system/boot.nix",
        diff: "-  boot.initrd.verbose = false;",
      },
    },
    {
      id: "h-fixer-updater",
      from: "fixer",
      to: "updater",
      label: "JSON report",
      payload: {
        outcome: "fixed",
        revertedInputs: [],
        filesChanged: ["modules/system/boot.nix"],
        summary: "drop boot.initrd.verbose, removed in nixpkgs",
      },
    },
    {
      id: "h-workspace-updater",
      from: "workspace",
      to: "updater",
      label: "import tree",
      payload: {
        index: ".git/flake-fixer-index",
        files: ["flake.lock", "modules/system/boot.nix"],
        gitlinks: [],
      },
    },
    {
      id: "h-blocked-updater",
      from: "blocked",
      to: "updater",
      label: "isBlocked",
      payload: { path: ".github/workflows/build-gate.yml", blocked: true },
    },
    {
      id: "h-updater-pr-fix",
      from: "updater",
      to: "pr",
      label: "push fixer commit",
      payload:
        "flake-fixer: drop boot.initrd.verbose, removed in nixpkgs\n\nFlake-Fixer-Round: 1\nFlake-Fixer-Session: ses_abc123\nFlake-Fixer-Review: required",
    },
    {
      id: "h-updater-issues",
      from: "updater",
      to: "issues",
      label: "held back / repair failed",
      payload: {
        title: "flake-update: repair failed",
        body: "The Flake fixer could not get the Build gate green on #241.\n\nReason: the Build gate is still red after 3 rounds\n\nModel: `opencode/deepseek-v4.1-flash-free`",
        labels: ["needs-triage", "automated"],
      },
    },
    {
      id: "h-issues-maintainer",
      from: "issues",
      to: "maintainer",
      label: "notification",
      payload: { issue: "flake-update: nixpkgs held back", failingHosts: "pewter" },
    },
    {
      id: "h-pr-maintainer",
      from: "pr",
      to: "maintainer",
      label: "ready-for-human",
      payload: {
        label: "ready-for-human",
        body: "**Needs review.** The Flake fixer changed more than reverting inputs, so auto-merge is off.",
      },
    },
    {
      id: "h-maintainer-pr",
      from: "maintainer",
      to: "pr",
      label: "review, merge by hand",
      payload: { action: "squash merge once 5 checks pass" },
    },
    {
      id: "h-maintainer-fixer",
      from: "maintainer",
      to: "fixer",
      label: "read session on :8444",
      payload: { url: "https://pewter.<tailnet>:8444", user: "opencode" },
    },
    {
      id: "h-main-watchdog",
      from: "main",
      to: "watchdog",
      label: "flake.lock commit age",
      payload: { command: "git log -1 --format=%ct -- flake.lock", ageDays: 34 },
    },
    {
      id: "h-watchdog-maintainer",
      from: "watchdog",
      to: "maintainer",
      label: "failure email",
      payload: "flake.lock has not changed in 34 days",
    },
  ],

  flows: [
    {
      id: "f-weekly",
      name: "A green week",
      hops: [
        "h-main-updater",
        "h-upstream-updater",
        "h-updater-pr",
        "h-pr-build",
        "h-attic-build",
        "h-build-attic",
        "h-pr-checks",
        "h-pr-scope",
        "h-blocked-scope",
        "h-build-ruleset",
        "h-checks-ruleset",
        "h-scope-ruleset",
        "h-ruleset-main",
      ],
    },
    {
      id: "f-repair",
      name: "A repair round",
      hops: [
        "h-ruleset-updater",
        "h-updater-workspace",
        "h-updater-fixer",
        "h-blocked-fixer",
        "h-fixer-workspace",
        "h-fixer-updater",
        "h-workspace-updater",
        "h-blocked-updater",
        "h-updater-pr-fix",
        "h-updater-issues",
      ],
    },
    {
      id: "f-review",
      name: "A fix that needs review",
      hops: [
        "h-pr-maintainer",
        "h-maintainer-fixer",
        "h-maintainer-pr",
        "h-ruleset-main",
      ],
    },
    {
      id: "f-stale",
      name: "The Updater went quiet",
      hops: ["h-main-watchdog", "h-watchdog-maintainer"],
    },
  ],

  chapters: [
    {
      id: "c-monday",
      title: "Monday, 02:00",
      lede: "A timer on pewter starts the Updater once a week.",
      story:
        "The Updater merges main into the flake-update branch, then asks upstream for new revisions with nix flake update. If the lock didn't change, it stops there.",
      reveals: ["updater", "main", "upstream"],
      plays: ["h-main-updater", "h-upstream-updater"],
    },
    {
      id: "c-pr",
      title: "One branch, one PR",
      lede: "Every week's update lands on the same branch and the same pull request.",
      story:
        "The Updater pushes and rewrites the PR body from what the branch holds. An open PR from last week keeps going, so a fix waiting on review isn't lost.",
      reveals: ["pr"],
      plays: ["h-updater-pr"],
    },
    {
      id: "c-gate",
      title: "The Build gate",
      lede: "GitHub's free runners build every host on both arches.",
      story:
        "One build job per arch builds all that arch's hosts in one store, and a checks job per arch builds the flake checks. The Attic cache on pewter saves rebuilding what's already built.",
      reveals: ["build", "checks", "attic"],
      plays: ["h-pr-build", "h-attic-build", "h-pr-checks", "h-build-attic"],
    },
    {
      id: "c-merge",
      title: "Scope and merge",
      lede: "Main's ruleset merges the PR only when five checks pass.",
      story:
        "flake-update-scope runs main's copy of itself and fails if the PR touches a path in blocked-paths.json. With all five checks green, GitHub squash-merges the PR into main.",
      reveals: ["scope", "blocked", "ruleset"],
      plays: [
        "h-pr-scope",
        "h-blocked-scope",
        "h-build-ruleset",
        "h-checks-ruleset",
        "h-scope-ruleset",
        "h-ruleset-main",
      ],
    },
    {
      id: "c-repair",
      title: "When the gate is red",
      lede: "The Flake fixer can repair a red gate, but it's switched off on pewter today.",
      story:
        "The Updater copies the branch into a workspace and prompts the agent with the trimmed errors. The agent edits files and replies with a JSON report. The Updater checks the result against blocked-paths.json, then commits and pushes it, for at most three rounds.",
      reveals: ["fixer", "workspace"],
      plays: [
        "h-ruleset-updater",
        "h-updater-workspace",
        "h-updater-fixer",
        "h-blocked-fixer",
        "h-fixer-workspace",
        "h-fixer-updater",
        "h-workspace-updater",
        "h-blocked-updater",
        "h-updater-pr-fix",
      ],
    },
    {
      id: "c-people",
      title: "Telling a person",
      lede: "Issues and the ready-for-human label bring the maintainer in.",
      story:
        "A held-back input or a failed repair becomes an automated issue. A fixer commit that changes code turns auto-merge off, so the maintainer reads it and merges by hand.",
      reveals: ["issues", "maintainer"],
      plays: [
        "h-updater-issues",
        "h-issues-maintainer",
        "h-pr-maintainer",
        "h-maintainer-fixer",
        "h-maintainer-pr",
      ],
    },
    {
      id: "c-watchdog",
      title: "The Watchdog",
      lede: "A monthly job notices when the Updater has gone quiet.",
      story:
        "If the Updater dies without a sound, nothing above fires. On the 1st of each month the Watchdog fails, and so emails, when flake.lock on main is over 30 days old.",
      reveals: ["watchdog"],
      plays: ["h-main-watchdog", "h-watchdog-maintainer"],
    },
    {
      id: "c-all",
      title: "The whole pipeline",
      lede: "Everything at once. Pick a flow to replay it.",
      story:
        "A green week runs from the timer to main without a person. The repair round and the review only happen when the gate is red, and the Watchdog covers the case where nothing runs at all.",
      reveals: [],
      plays: [],
    },
  ],
};
