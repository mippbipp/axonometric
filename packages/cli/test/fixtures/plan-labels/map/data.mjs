// The shape of a real 14-structure, 27-hop map in 5 groups, with its text cut
// down: in Plan view its hop labels sat on routes or far from them.
export default {
  format: 1,
  revision: 0,
  overview: { title: "Plan labels", summary: "Hops packed between zones." },
  groups: [
    {
      "id": "pewter",
      "title": "pewter"
    },
    {
      "id": "repo",
      "title": "GitHub repository"
    },
    {
      "id": "actions",
      "title": "GitHub Actions"
    },
    {
      "id": "upstream",
      "title": "Upstream"
    },
    {
      "id": "people",
      "title": "People"
    }
  ],
  structures: [
    {
      "id": "timer",
      "code": "T",
      "name": "Update timer",
      "tag": "flake-updater.timer",
      "shape": "job",
      "group": "pewter",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "updater",
      "code": "U",
      "name": "Updater",
      "tag": "flake-updater",
      "shape": "tall",
      "group": "pewter",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "inputs",
      "code": "UP",
      "name": "Flake inputs",
      "tag": "upstream inputs",
      "shape": "external",
      "group": "upstream",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "main",
      "code": "M",
      "name": "main branch",
      "tag": "main",
      "shape": "store",
      "group": "repo",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "pr",
      "code": "PR",
      "name": "flake-update PR",
      "tag": "flake-update PR",
      "shape": "document",
      "group": "repo",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "bg",
      "code": "BG",
      "name": "build-gate",
      "tag": "build-gate",
      "shape": "gate",
      "group": "actions",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "attic",
      "code": "A",
      "name": "Attic cache",
      "tag": "Attic cache",
      "shape": "store",
      "group": "pewter",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "scope",
      "code": "SC",
      "name": "flake-update-scope",
      "tag": "scope check",
      "shape": "gate",
      "group": "actions",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "blocked",
      "code": "BL",
      "name": "blocked-paths.json",
      "tag": "blocked paths",
      "shape": "document",
      "group": "pewter",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "ruleset",
      "code": "RS",
      "name": "Merge ruleset",
      "tag": "ruleset on main",
      "shape": "gate",
      "group": "repo",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "fixer",
      "code": "F",
      "name": "Flake fixer",
      "tag": "Flake fixer",
      "shape": "box",
      "group": "pewter",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "issues",
      "code": "IS",
      "name": "Automated issues",
      "tag": "automated issues",
      "shape": "document",
      "group": "repo",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "me",
      "code": "ME",
      "name": "Maintainer",
      "tag": "you",
      "shape": "person",
      "group": "people",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    },
    {
      "id": "wd",
      "code": "W",
      "name": "Watchdog",
      "tag": "update-watchdog",
      "shape": "job",
      "group": "actions",
      "status": "live",
      "oneLiner": "One line.",
      "whatItDoes": "Does it.",
      "howItsBuilt": "Built."
    }
  ],
  hops: [
    {
      "id": "h-fire",
      "from": "timer",
      "to": "updater",
      "label": "start service",
      "payload": {}
    },
    {
      "id": "h-lock-update",
      "from": "updater",
      "to": "inputs",
      "label": "nix flake update",
      "payload": {}
    },
    {
      "id": "h-new-revs",
      "from": "inputs",
      "to": "updater",
      "label": "newer revisions",
      "payload": {}
    },
    {
      "id": "h-fetch-main",
      "from": "main",
      "to": "updater",
      "label": "fetch origin",
      "payload": {}
    },
    {
      "id": "h-push-pr",
      "from": "updater",
      "to": "pr",
      "label": "push, open PR",
      "payload": {}
    },
    {
      "id": "h-trigger",
      "from": "pr",
      "to": "bg",
      "label": "pull_request",
      "payload": {}
    },
    {
      "id": "h-substitute",
      "from": "attic",
      "to": "bg",
      "label": "substitute paths",
      "payload": {}
    },
    {
      "id": "h-attic-push",
      "from": "bg",
      "to": "attic",
      "label": "push closures",
      "payload": {}
    },
    {
      "id": "h-bg-checks",
      "from": "bg",
      "to": "pr",
      "label": "check runs",
      "payload": {}
    },
    {
      "id": "h-scope-trigger",
      "from": "pr",
      "to": "scope",
      "label": "pull_request_target",
      "payload": {}
    },
    {
      "id": "h-blocked-read",
      "from": "blocked",
      "to": "scope",
      "label": "list from base ref",
      "payload": {}
    },
    {
      "id": "h-scope-check",
      "from": "scope",
      "to": "pr",
      "label": "scope result",
      "payload": {}
    },
    {
      "id": "h-pr-ruleset",
      "from": "pr",
      "to": "ruleset",
      "label": "checks on head",
      "payload": {}
    },
    {
      "id": "h-merge",
      "from": "ruleset",
      "to": "main",
      "label": "allow squash merge",
      "payload": {}
    },
    {
      "id": "h-rules",
      "from": "ruleset",
      "to": "updater",
      "label": "required checks",
      "payload": {}
    },
    {
      "id": "h-rollup",
      "from": "pr",
      "to": "updater",
      "label": "rollup and logs",
      "payload": {}
    },
    {
      "id": "h-prompt",
      "from": "updater",
      "to": "fixer",
      "label": "prompt with errors",
      "payload": {}
    },
    {
      "id": "h-block-fixer",
      "from": "blocked",
      "to": "fixer",
      "label": "edit policies",
      "payload": {}
    },
    {
      "id": "h-report",
      "from": "fixer",
      "to": "updater",
      "label": "JSON report",
      "payload": {}
    },
    {
      "id": "h-block-up",
      "from": "blocked",
      "to": "updater",
      "label": "isBlocked() check",
      "payload": {}
    },
    {
      "id": "h-fix-push",
      "from": "updater",
      "to": "pr",
      "label": "commit and push",
      "payload": {}
    },
    {
      "id": "h-issue",
      "from": "updater",
      "to": "issues",
      "label": "open or comment",
      "payload": {}
    },
    {
      "id": "h-notify",
      "from": "issues",
      "to": "me",
      "label": "notification",
      "payload": {}
    },
    {
      "id": "h-review",
      "from": "me",
      "to": "pr",
      "label": "review, merge by hand",
      "payload": {}
    },
    {
      "id": "h-session",
      "from": "me",
      "to": "fixer",
      "label": "open session",
      "payload": {}
    },
    {
      "id": "h-wd-read",
      "from": "main",
      "to": "wd",
      "label": "newest flake.lock commit",
      "payload": {}
    },
    {
      "id": "h-wd-alert",
      "from": "wd",
      "to": "me",
      "label": "failed run",
      "payload": {}
    }
  ],
  flows: [],
  chapters: [
    {
      "id": "c-monday",
      "title": "Monday on pewter",
      "lede": "Lede.",
      "story": "Story.",
      "reveals": [
        "timer",
        "updater",
        "inputs"
      ],
      "plays": [
        "h-fire",
        "h-lock-update",
        "h-new-revs"
      ]
    },
    {
      "id": "c-branch",
      "title": "One branch, one PR",
      "lede": "Lede.",
      "story": "Story.",
      "reveals": [
        "main",
        "pr"
      ],
      "plays": [
        "h-fetch-main",
        "h-push-pr"
      ]
    },
    {
      "id": "c-gate",
      "title": "The Build gate",
      "lede": "Lede.",
      "story": "Story.",
      "reveals": [
        "bg",
        "attic"
      ],
      "plays": [
        "h-trigger",
        "h-substitute",
        "h-attic-push",
        "h-bg-checks"
      ]
    },
    {
      "id": "c-scope",
      "title": "Scope and merge",
      "lede": "Lede.",
      "story": "Story.",
      "reveals": [
        "scope",
        "blocked",
        "ruleset"
      ],
      "plays": [
        "h-scope-trigger",
        "h-blocked-read",
        "h-scope-check",
        "h-pr-ruleset",
        "h-merge"
      ]
    },
    {
      "id": "c-red",
      "title": "When the gate is red",
      "lede": "Lede.",
      "story": "Story.",
      "reveals": [
        "fixer"
      ],
      "plays": [
        "h-rules",
        "h-rollup",
        "h-prompt",
        "h-block-fixer",
        "h-report",
        "h-block-up",
        "h-fix-push"
      ]
    },
    {
      "id": "c-person",
      "title": "Telling a person",
      "lede": "Lede.",
      "story": "Story.",
      "reveals": [
        "issues",
        "me"
      ],
      "plays": [
        "h-issue",
        "h-notify",
        "h-review",
        "h-session"
      ]
    },
    {
      "id": "c-watchdog",
      "title": "The watchdog",
      "lede": "Lede.",
      "story": "Story.",
      "reveals": [
        "wd"
      ],
      "plays": [
        "h-wd-read",
        "h-wd-alert"
      ]
    },
    {
      "id": "c-whole",
      "title": "The whole pipeline",
      "lede": "Lede.",
      "story": "Story.",
      "reveals": [],
      "plays": []
    }
  ],
};
