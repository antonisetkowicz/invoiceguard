#!/bin/bash
set -e

echo "=== VoxDrop Android Build Script ==="
echo ""

# Check prerequisites
command -v npx >/dev/null 2>&1 || { echo "npx not found. Install Node.js first."; exit 1; }
command -v eas >/dev/null 2>&1 || { echo "EAS CLI not found. Run: npm install -g eas-cli"; exit 1; }

cd "$(dirname "$0")/../app"

echo "Step 1: Install dependencies"
npm install

echo ""
echo "Step 2: Log in to Expo (if needed)"
npx eas whoami 2>/dev/null || npx eas login

echo ""
echo "Step 3: Configure EAS project"
npx eas build:configure

echo ""
echo "=== Choose a build type ==="
echo "1) APK (for testing - installs directly on device)"
echo "2) AAB (for Play Store submission)"
read -p "Enter choice (1 or 2): " choice

case $choice in
  1)
    echo "Building APK (preview profile)..."
    npx eas build --platform android --profile preview
    ;;
  2)
    echo "Building AAB (production profile)..."
    echo ""
    echo "IMPORTANT: EAS will generate a keystore for you on first build."
    echo "Download and back up your keystore from expo.dev after the build!"
    echo ""
    npx eas build --platform android --profile production
    ;;
  *)
    echo "Invalid choice. Exiting."
    exit 1
    ;;
esac

echo ""
echo "=== Build submitted! ==="
echo "Track progress at: https://expo.dev"
echo ""
echo "Next steps:"
echo "1. Download the APK/AAB from expo.dev when build completes"
echo "2. For Play Store: upload AAB to Google Play Console"
echo "3. Fill out store listing using store-listing/play-store-listing.md"
echo "4. Complete content rating questionnaire"
echo "5. Submit for review"
