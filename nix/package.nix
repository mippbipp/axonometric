{
  lib,
  stdenvNoCC,
  bun,
  cacert,
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
      ../bun.lock
      ../bunfig.toml
      ../packages
    ];
  };

  # The CLI and the workspace packages it builds from. The filter skips the
  # root's dev tools, such as oxlint, lefthook and react-doctor.
  #
  # A fixed-output derivation can reach the network, so it runs the
  # install and keeps node_modules. `--os`, `--cpu` and `--libc` fetch every
  # platform's optional packages, so one hash holds on every system. Install
  # scripts are skipped because the result is only used to build. Changes
  # whenever bun.lock changes. See CONTRIBUTING.md.
  bunDeps = stdenvNoCC.mkDerivation {
    pname = "${finalAttrs.pname}-bun-deps";
    inherit (finalAttrs) version src;

    nativeBuildInputs = [
      bun
      cacert
    ];

    dontConfigure = true;
    dontFixup = true;

    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR
      export SSL_CERT_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt
      export BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache
      bun install \
        --frozen-lockfile \
        --filter axonometric \
        --os '*' \
        --cpu '*' \
        --libc '*' \
        --ignore-scripts \
        --backend copyfile \
        --no-progress
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir $out
      find . -name node_modules -type d -prune -print0 \
        | while IFS= read -r -d "" dir; do
            mkdir -p "$out/$(dirname "$dir")"
            cp -R "$dir" "$out/$dir"
          done
      runHook postInstall
    '';

    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-7SDuDm08h0IB+lo8xKfH0F8/iH5Z4+2yTVKXZOamstg=";
  };

  nativeBuildInputs = [
    bun
    nodejs_24
    makeBinaryWrapper
  ];

  configurePhase = ''
    runHook preConfigure
    (cd ${finalAttrs.bunDeps} && find . -name node_modules -type d -prune -print0) \
      | while IFS= read -r -d "" dir; do
          mkdir -p "$(dirname "$dir")"
          cp -R ${finalAttrs.bunDeps}/"$dir" "$dir"
        done
    chmod -R u+w .
    # The sandbox has no /usr/bin/env, which the bin scripts' shebangs use.
    patchShebangs node_modules packages/*/node_modules
    export HOME=$TMPDIR
    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild
    bun run --cwd packages/editor build
    bun run --cwd packages/cli build
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
    $out/bin/axonometric docs review | grep -q 'axonometric verdict'
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
