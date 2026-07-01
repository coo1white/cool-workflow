class CoolWorkflow < Formula
  desc "Workflow control plane that checks agent work against facts before it ships"
  homepage "https://github.com/coo1white/cool-workflow"
  # git url + tag (no sha256): the git tag is the integrity pin, so there is no
  # post-publish checksum step. Homebrew reads the version FROM the tag, so the
  # tag is the one version surface — auto-bumped by
  # plugins/cool-workflow/scripts/bump-version.js and gated by version:sync.
  url "https://github.com/coo1white/cool-workflow.git", tag: "v0.1.98"
  license "BSD-2-Clause"

  depends_on "node"

  # The npm package lives in plugins/cool-workflow/ inside the repo. dist/ is
  # committed and there are zero runtime deps, so npm install only packs the
  # package into libexec and links the bins (cw, cool-workflow) — no build runs.
  def install
    cd "plugins/cool-workflow" do
      system "npm", "install", *std_npm_args
      bin.install_symlink Dir["#{libexec}/bin/*"]
    end
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/cw version")
  end
end
