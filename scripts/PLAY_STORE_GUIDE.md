# Google Play Store Submission Guide

## Prerequisites Checklist
- [ ] Google Play Console developer account ($25 one-time fee)
- [ ] Identity verification completed in Play Console
- [ ] Privacy policy hosted at a public URL
- [ ] AAB file built via `./scripts/build-android.sh`
- [ ] Store listing assets created (see `store-listing/asset-specs.md`)

## Step-by-Step Submission

### 1. Create the App in Play Console
1. Go to https://play.google.com/console
2. Click "Create app"
3. Fill in:
   - App name: **VoxDrop — Anonymous Voice Notes**
   - Default language: English (US)
   - App or game: **App**
   - Free or paid: **Free**
4. Accept declarations and click "Create app"

### 2. Set Up Store Listing
1. Go to **Grow > Store presence > Main store listing**
2. Fill in:
   - Short description (from `play-store-listing.md`)
   - Full description (from `play-store-listing.md`)
   - Upload app icon (512x512)
   - Upload feature graphic (1024x500)
   - Upload at least 2 phone screenshots (1080x1920)
3. Save

### 3. Content Rating
1. Go to **Policy > App content > Content rating**
2. Start the questionnaire
3. Answer honestly:
   - Does the app contain user-generated content? **Yes** (voice notes)
   - Does the app allow users to communicate? **Yes** (text responses)
   - Does the app contain in-app purchases? **Yes** (reveal unlock)
4. Expected rating: **Teen** or **Mature 17+** depending on answers

### 4. App Access
1. Go to **Policy > App content > App access**
2. Select "All functionality is available without special access"
   (anonymous auth means no login required)

### 5. Data Safety
1. Go to **Policy > App content > Data safety**
2. Declare:
   - **Audio files**: Collected (voice notes), shared with other users
   - **User IDs**: Collected, not shared (internal tracking)
   - **Purchase history**: Collected via Stripe
   - Data encrypted in transit: **Yes**
   - Data deletion possible: **Yes** (user can request)
3. Complete and submit

### 6. Target Audience
1. Go to **Policy > App content > Target audience**
2. Target age group: **18 and over** (recommended for anonymous social)
3. This is NOT a children's app

### 7. Upload the AAB
1. Go to **Release > Testing > Internal testing** (recommended first)
2. Click "Create new release"
3. Upload the `.aab` file
4. Add release notes: "Initial release of VoxDrop"
5. Review and start rollout

### 8. Move to Production
1. After internal testing is validated
2. Go to **Release > Production**
3. Create new release, upload AAB
4. Submit for review

### Review Timeline
- Internal testing: Available immediately
- Closed testing: Usually approved within hours
- Production (new app): 3-7 days for first review
- Production (updates): Usually 1-3 days

## Important Notes
- First-time apps get extra scrutiny — expect up to 7 days
- Anonymous social apps may require additional review
- You MUST have a privacy policy URL before submission
- Voice recording apps require microphone permission justification (already set in app.json)
- In-app purchases require a linked Stripe/payment merchant — Google doesn't handle this since we use Stripe directly
