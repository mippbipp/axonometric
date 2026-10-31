{
  nixConfig = {
    extra-substituters = [ "https://cache.numtide.com" ];
    extra-trusted-public-keys = [
      "niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g="
    ];
  };

  description = "axonometric dev shell";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
    # Not following our nixpkgs, so agent-browser comes from numtide's cache.
    llm-agents.url = "github:numtide/llm-agents.nix";
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      llm-agents,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        inherit (pkgs) lib stdenv;
        browsers = pkgs.playwright-driver.browsers;
        # nixpkgs only packages Playwright's browsers for Linux.
        chromiumRevision = pkgs.playwright-driver.browsersJSON.chromium.revision;
        chromiumDir = "${browsers}/chromium-${chromiumRevision}";
      in
      {
        devShells.default = pkgs.mkShell {
          nativeBuildInputs = [
            pkgs.nodejs_24
            pkgs.pnpm_12
            llm-agents.packages.${system}.agent-browser
          ];

          shellHook = ''
            ${lib.optionalString stdenv.hostPlatform.isLinux ''
              export PLAYWRIGHT_BROWSERS_PATH=${browsers}
              export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
              # The folder is chrome-linux or chrome-linux64 depending on the build.
              for chrome in ${chromiumDir}/chrome-linux*/chrome; do
                export AGENT_BROWSER_EXECUTABLE_PATH="$chrome"
              done
            ''}
            echo "axonometric dev shell: node $(node --version), pnpm $(pnpm --version)"
          '';
        };
      }
    );
}
