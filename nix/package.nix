{
  lib,
  stdenvNoCC,
  fetchPnpmDeps,
  pnpmConfigHook,
  pnpm_12,
  nodejs_24,
  nodejs-slim_24,
  makeBinaryWrapper,
}:
let
  root = ../.;
  cliPackage = lib.importJSON ../packages/cli/package.json;
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "axonometric";
  inherit (cliPackage) version;

  src = lib.fileset.toSource {
    inherit root;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../tsconfig.json
      ../packages
    ];
  };

  # The CLI and the workspace packages it builds from. This skips the root's
  # dev tools, such as oxlint, lefthook and react-doctor.
  pnpmWorkspaces = [ "axonometric..." ];

  # fetchPnpmDeps already fetches every platform's optional packages. The one
  # host-specific download is the Node binary that `devEngines.runtime` in
  # package.json declares, which would change the hash on every system. The
  # build runs nixpkgs' Node, so skip it.
  pnpmInstallFlags = [ "--no-runtime" ];

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs)
      pname
      version
      src
      pnpmWorkspaces
      pnpmInstallFlags
      ;
    pnpm = pnpm_12;
    fetcherVersion = 5;
    # Changes whenever pnpm-lock.yaml changes. See "Development" in README.md.
    hash = "sha256-hZRkq8jPfGwtM7+Q6Wuiufo0SCPaQXTYSZZTLLLI8IM=";
  };

  nativeBuildInputs = [
    nodejs_24
    pnpm_12
    pnpmConfigHook
    makeBinaryWrapper
  ];

  buildPhase = ''
    runHook preBuild
    pnpm --filter @axonometric/editor run build
    pnpm --filter axonometric run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm644 packages/cli/dist/bin.mjs $out/lib/axonometric/bin.mjs
    # The slim build leaves out npm and corepack, which the bundle doesn't use.
    makeWrapper ${lib.getExe nodejs-slim_24} $out/bin/axonometric \
      --add-flags $out/lib/axonometric/bin.mjs
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    $out/bin/axonometric --version
    cp -r packages/cli/test/fixtures/pipeline "$TMPDIR/pipeline"
    chmod -R u+w "$TMPDIR/pipeline"
    $out/bin/axonometric build "$TMPDIR/pipeline/map"
    test -s "$TMPDIR/pipeline/SYSTEM.md"
    test -s "$TMPDIR/pipeline/pipeline.html"
    runHook postInstallCheck
  '';

  meta = {
    inherit (cliPackage) description;
    homepage = "https://github.com/mippbipp/axonometric";
    license = lib.licenses.mit;
    mainProgram = "axonometric";
    platforms = import ./systems.nix;
  };
})
