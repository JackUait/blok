#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get repository info from package.json
REPO_URL=$(node -p "require('./package.json').repository.url.replace('git+', '').replace('.git', '')")
REPO_OWNER=$(echo "$REPO_URL" | sed 's|https://github.com/||' | cut -d'/' -f1)
REPO_NAME=$(echo "$REPO_URL" | sed 's|https://github.com/||' | cut -d'/' -f2)

# Parse arguments
RELEASE_TYPE="${1:-release}"
PRERELEASE_TYPE="${2:-beta}"
DRY_RUN="${3:-false}"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  📦 Blok Release Trigger${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${YELLOW}Release Type:${NC}     $RELEASE_TYPE"
if [ "$RELEASE_TYPE" = "prerelease" ]; then
  echo -e "  ${YELLOW}Pre-release:${NC}      $PRERELEASE_TYPE"
fi
echo -e "  ${YELLOW}Dry Run:${NC}          $DRY_RUN"
echo -e "  ${YELLOW}Repository:${NC}       $REPO_OWNER/$REPO_NAME"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
  echo -e "${RED}Error: GitHub CLI (gh) is not installed.${NC}"
  echo ""
  echo "Install it with:"
  echo "  brew install gh"
  echo ""
  echo "Then authenticate:"
  echo "  gh auth login"
  exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
  echo -e "${RED}Error: Not authenticated with GitHub CLI.${NC}"
  echo ""
  echo "Run: gh auth login"
  exit 1
fi

# Confirm before triggering
echo -e "${YELLOW}This will trigger the Release workflow on GitHub Actions.${NC}"
read -p "Continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${RED}Cancelled.${NC}"
  exit 0
fi

echo ""
echo -e "${BLUE}Triggering workflow...${NC}"

# Trigger the workflow
gh workflow run release.yml \
  --repo "$REPO_OWNER/$REPO_NAME" \
  -f "release-type=$RELEASE_TYPE" \
  -f "prerelease-type=$PRERELEASE_TYPE" \
  -f "dry-run=$DRY_RUN"

echo ""
echo -e "${GREEN}✓ Workflow triggered successfully!${NC}"
echo ""
echo -e "View the run at:"
echo -e "  ${BLUE}https://github.com/$REPO_OWNER/$REPO_NAME/actions/workflows/release.yml${NC}"
echo ""

# Optionally open in browser
read -p "Open in browser? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  open "https://github.com/$REPO_OWNER/$REPO_NAME/actions/workflows/release.yml"
fi
