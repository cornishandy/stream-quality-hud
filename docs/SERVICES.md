# Best streaming quality per service and browser

Researched 18 Oct 2026 by GPT-6.1-Sol from the services' own help pages (press only where noted). The HUD's `SERVICES` table in `extension/hud.js` is a short summary of this; update both together.

Caps are for browsers on a Mac. "unknown" means the service doesn't publish it. Orion isn't covered by any service's documentation; Safari figures are Safari-only.

## Netflix

- **Best anywhere:** 4K/2160p [n1,n4]; HDR: Dolby Vision, HDR10, HDR10+; device-dependent [n2,n4]. Where: Compatible TV/streaming-device apps; Windows app: 4K HDR; Mac: no official app [n3,n4,n6]
- **Mac browsers:** Chrome: 1080p; HDR unknown [n1] · Safari: 2160p; Dolby Vision/HDR10 supported [n1,n2] · Firefox: 1080p; HDR unknown [n1] · Edge: 720p; HDR unknown [n1]
- Premium for 4K/HDR [n5].
- Mac 4K: Apple silicon or T2, UHD-capable display, macOS 11+, latest Safari; external displays must each support 4K/60Hz and HDCP 2.2; 15 Mbps; Auto/High playback [n2].
- Mac HDR: compatible HDR display, macOS 10.15.4+, HDR enabled; disable battery video optimization [n2].
- Windows 4K: updated Windows 11, supported GPU/CPU, HEVC support, 4K/60Hz display and HDCP 2.2 external connection; every active display must qualify [n3].
- Notes: Older Chrome=720p/Windows Chrome=1080p tables are superseded by n1. The Mac article's 'two' HDR formats is Mac-specific; it must not exclude service-wide HDR10+. Orion: unknown.
- Sources:
  - [n1] <https://help.netflix.com/en/node/30081> — “Up to Ultra HD (2160p) … Up to Full HD (1080p) … Up to HD (720p)” (checked 2026-10-18)
  - [n2] <https://help.netflix.com/en/node/55764> — “Apple processor or Apple T2 Security chip … Dolby Vision and HDR10” (checked 2026-10-18)
  - [n3] <https://help.netflix.com/en/node/23931> — “Microsoft Edge … Up to Ultra HD (4K or 2160p) with HDR” (checked 2026-10-18)
  - [n4] <https://help.netflix.com/en/node/13444> — “HDR or HDR10+: Another system for high dynamic range video.” (checked 2026-10-18)
  - [n5] <https://help.netflix.com/en/node/24926> — “Premium … Watch in 4K (Ultra HD) + HDR” (checked 2026-10-18)
  - [n6] <https://help.netflix.com/en/node/12983> — “The Netflix app is available only on the App Store for iPhone, iPad, and Apple TV.” (checked 2026-10-18)

## Prime Video

- **Best anywhere:** 4K/UHD [p2,p3]; HDR: Dolby Vision, HDR10, HDR10+ [p2]. Where: Compatible TV/streaming-device apps, including Apple TV 4K; Mac and Windows apps officially documented only as up to HD [p1,p3]
- **Mac browsers:** Chrome: HD; numeric ceiling and HDR unknown [p1] · Safari: HD; numeric ceiling and HDR unknown; no documented browser 4K [p1] · Firefox: HD; numeric ceiling and HDR unknown [p1] · Edge: HD; numeric ceiling and HDR unknown [p1]
- US: Prime Video Ultra required for included Prime movies/TV in 4K/UHD from April 10, 2026; underlying Prime/Prime Video subscription required [p2].
- HDR10, HDR10+ and Dolby Vision remain included with the base US Prime benefit; resolution and HDR are separate entitlements [p2].
- External HDMI connections: HDCP 1.4 for HD; HDCP 2.2 for UHD/HDR [p4].
- Notes: Match amazon.com only under /gp/video. Do not translate Amazon's unspecified 'HD' into a guaranteed 1080p cap. Older guidance saying base Prime includes 4K, or Dolby Vision requires Ad Free, is outdated for the US; other countries differ. Orion: unknown.
- Sources:
  - [p1] <https://www.primevideo.com/help?nodeId=GUX9FYHU5D8LC9EJ> — “Streaming Video Quality - up to HD” (checked 2026-10-18)
  - [p2] <https://www.aboutamazon.com/news/entertainment/prime-video-ultra-ad-free-streaming-subscription> — “exclusive access to 4K/UHD streaming … including HD, HDR10, HDR10+, and now Dolby Vision” (checked 2026-10-18)
  - [p3] <https://www.primevideo.com/help?nodeId=GTAQMQBSRQKKE9FJ> — “up to Ultra HD (Apple TV 4K); up to HD (all other models)” (checked 2026-10-18)
  - [p4] <https://www.primevideo.com/help?nodeId=GU85HKX66NVFNQ9Y> — “HDCP 1.4 (για περιεχόμενο HD) και HDCP 2.2 (για περιεχόμενο UHD ή/και HDR)” (checked 2026-10-18)

## Disney+

- **Best anywhere:** 4K/2160p [d1,d2]; HDR: Dolby Vision, HDR10; HDR10+ for supported content/devices [d2,d3]. Where: Compatible smart-TV/TV-connected apps; HDR10+ documented on Samsung Crystal UHD-and-above TVs from 2018 and selected Smart Monitors. Desktop app ceilings unknown [d1,d3]
- **Mac browsers:** Chrome: 720p; HDR unknown [d1] · Safari: 720p; no browser 4K; HDR unknown [d1] · Firefox: 720p; HDR unknown [d1] · Edge: 720p; HDR unknown [d1]
- Compatible 4K/HDR title, playback device and display; Automatic quality setting [d1,d2].
- US: both With Ads and Premium advertise 4K/HDR. UK: Premium required; Standard tiers cap at 1080p [d4,d5].
- Samsung HDR10+ launch initially covered over 1,000 Hulu titles inside Disney+; broader content/device coverage is not fully documented [d3].
- Notes: Browser figure comes from the June 29, 2026 article. HDR10+ omission from the March 2026 general help article is incomplete relative to Samsung's October 2025 launch announcement. Windows app ceiling unknown; Mac native app availability/ceiling unknown. Orion: unknown.
- Sources:
  - [d1] <https://help.disneyplus.com/article/disneyplus-en-ph-data-usage> — “computer browsers, which are limited to 720p HD … Video quality: 4K UHD & HDR” (checked 2026-10-18)
  - [d2] <https://help.disneyplus.com/es-PA/article/disneyplus-video-quality> — “HDR10 is the default HDR format … Dolby Vision is a more dynamic version of HDR.” (checked 2026-10-18)
  - [d3] <https://news.samsung.com/us/hdr10-supported-content-on-disney-launches-first-on-samsung-tvs/> — “over 1,000 Hulu titles in HDR10+ within the Disney+ app” (checked 2026-10-18)
  - [d4] <https://help.disneyplus.com/iw/article/disneyplus-price> — “Disney+ (With Ads) … Experience video quality in up to 4K UHD & HDR” (checked 2026-10-18)
  - [d5] <https://help.disneyplus.com/en-GB/article/disneyplus-en-dm-price> — “Disney+ Premium … Experience in up to 4K UHD and HDR video” (checked 2026-10-18)

## HBO Max

- **Best anywhere:** 4K/UHD [m1]; HDR: Dolby Vision, HDR10; HDR10+ unknown [m1]. Where: Supported TV/streaming-device apps including Apple TV 4K, Fire TV, selected Roku/Google TV/smart TVs and PS5. Desktop setup directs Mac/PC users to the website [m1,m3]
- **Mac browsers:** Chrome: 720p; HDR unknown [m2] · Safari: 720p; no documented browser 4K/HDR [m2] · Firefox: 720p; HDR unknown [m2] · Edge: unknown; official supported-browser wording specifies Edge for Windows [m3]
- Premium plan, qualifying 4K HDR TV/device and title [m1].
- 25 Mbps minimum; 50+ Mbps recommended; HDMI 2.0 and HDCP 2.2 throughout the external display chain [m1].
- Notes: 720p is the current official website claim, although it sits in undated troubleshooting text that looks like legacy guidance. Plan advertising of Full HD does not establish a 1080p browser cap. Separate Mac/Windows app ceilings unknown. Orion: unknown.
- Sources:
  - [m1] <https://help.hbomax.com/us-en/answer/detail/000002523> — “4K UHD with HDR10 or Dolby Vision … Premium plan … HDMI 2.0 and HDCP 2.2” (checked 2026-10-18)
  - [m2] <https://help.hbomax.com/us-en/answer/detail/000002521> — “The highest resolution supported at HBOMax.com is 720p.” (checked 2026-10-18)
  - [m3] <https://help.hbomax.com/us-en/answer/detail/000002506> — “Chrome, Firefox, Microsoft Edge for Windows, or Safari.” (checked 2026-10-18)

## Apple TV+

- **Best anywhere:** 4K/2160p [a1,a2,a3]; HDR: Dolby Vision, HDR10; HDR10+ confirmed service-wide by the format association [a1,a4,a5]. Where: Apple TV 4K and compatible TV apps; native Mac and Windows apps offer up to 4K HDR [a1,a2,a3]
- **Mac browsers:** Chrome: 1080p; HDR unknown [a1] · Safari: 4K HDR; browser-specific HDR format mapping unknown [a1,a6] · Firefox: 1080p; HDR unknown [a1] · Edge: 1080p; HDR unknown [a1]
- Safari: latest macOS and compatible device/display [a1].
- Native apps: select High Quality (Up to 4K); compatible HDR hardware [a2,a3].
- Mac HDR: supported Mac, latest macOS and HDR display; external HDR enabled; battery optimization can force SDR. Some Intel Macs may be limited to 1080p HDR [a4].
- Apple recommends 25 Mbps for 4K [a1,a4].
- Notes: a1 is dated February 2025 and framed around Apple TV movie purchases, but explicitly documents tv.apple.com; Apple's current Safari page independently names Apple TV+. Do not apply Netflix's T2 requirement to Apple TV+. Orion: unknown.
- Sources:
  - [a1] <https://support.apple.com/en-us/119599> — “compatible content may play in up to 4K HDR … compatible content will play in up to 1080p (HD)” (checked 2026-10-18)
  - [a2] <https://support.apple.com/guide/tvapp-mac/playback-settings-tvdf855a1b/mac> — “High Quality (Up to 4K): Streams the highest quality video, including HDR video when it’s available.” (checked 2026-10-18)
  - [a3] <https://support.apple.com/en-au/guide/tvapp-windows/tvdf855a1b/windows> — “High Quality (Up to 4K): Streams the highest-quality video, including HDR video when it’s available.” (checked 2026-10-18)
  - [a4] <https://support.apple.com/en-us/102205> — “The built-in display and Apple Pro Display XDR support Dolby Vision, HDR10, and HLG.” (checked 2026-10-18)
  - [a5] <https://hdr10plus.org/wp-content/uploads/2025/01/HDR10CESpressreaseD4_Press-release.pdf> — “including Apple TV+, Hulu, Paramount+, Prime Video and YouTube.” (checked 2026-10-18)
  - [a6] <https://www.apple.com/safari/> — “Safari supports in-browser 4K HDR video playback for YouTube, Netflix, and Apple TV+.” (checked 2026-10-18)

## Hulu

- **Best anywhere:** 4K/UHD [h1]; HDR: Dolby Vision, HDR10, HDR10+ [h1]. Where: Selected Apple TV, Fire TV, Roku, Chromecast Ultra, LG, Samsung and Vizio apps; exact HDR formats vary by device. Separate desktop-app ceilings unknown [h1]
- **Mac browsers:** Chrome: 720p; HDR unknown [h1] · Safari: 720p; no browser 4K; HDR unknown [h1] · Firefox: 720p; HDR unknown [h1] · Edge: 720p website ceiling; HDR unknown [h1]
- 4K: supported title/app/device and 16 Mbps [h1].
- Browser 720p requires an HDCP-compliant configuration; HDR devices must connect to an HDCP 2.2 TV [h1].
- No additional plan gate for 4K/HDR is stated in the quality article [h1].
- Notes: Official article updated September 28, 2026. Its HDR device list contains TV/streaming devices, not desktop browsers; this is not an explicit universal no-HDR-browser statement. Hulu inside Disney+ is a separate playback environment. Orion: unknown.
- Sources:
  - [h1] <https://help.hulu.com/article/hulu-video-quality> — “Hulu.com streams in quality up to 720p … HDR10, HDR10+, and Dolby Vision … 4K Ultra HD: 16 Mbps” (checked 2026-10-18)

## Paramount+

- **Best anywhere:** 4K/UHD [r1,r2]; HDR: Dolby Vision, HDR10 [r1,r2]; HDR10+ confirmed by format association, device mapping unknown [r4]. Where: Supported Apple TV 4K, Fire TV, Roku and other qualifying TV/device apps; Mac/Windows app ceilings unknown [r2]
- **Mac browsers:** Chrome: unknown · Safari: unknown; 4K/HDR not established by browser documentation · Firefox: unknown · Edge: unknown
- Premium plan and qualifying title/device/display [r1,r2].
- HDMI 2.0 with HDCP 2.2 throughout an external device chain [r2].
- Connection guidance conflicts: one official article says 25 Mbps; another recommends 15 Mbps [r2,r3].
- Notes: Official browser page provides compatibility, not resolution/HDR ceilings, and retains old OS/browser minimums. Do not equate Premium's 4K entitlement with browser 4K. International and US device lists differ. Orion: unknown.
- Seen in use (19 Oct 2026, one film, Safari on a Mac with an HDR screen): Paramount+ sent Safari 6 HLS versions, the top one 1920×1080 H.264 SDR at 3.9 Mbps, with AAC stereo. One title, so not a published limit.
- Sources:
  - [r1] <https://www.paramountplus.com/account/signup/pickplan/> — “Watch in 4K UHD, Dolby Vision or HDR10” (checked 2026-10-18)
  - [r2] <https://support.paramountplus.com/s/article/PI-premium-video-and-audio-formats?language=en_US> — “High speed internet of 25 Mbps or higher … HDMI 2.0 port that supports HDCP 2.2 or later” (checked 2026-10-18)
  - [r3] <https://cbsi.my.salesforce-sites.com/CBSi/articles/en_US/Knowledge/PI-Which-premium-video-streaming-formats-supported?data=&popup=false&template=ottShoTemplate> — “We recommend an internet speed of at least 15 Mbps” (checked 2026-10-18)
  - [r4] <https://hdr10plus.org/wp-content/uploads/2025/01/HDR10CESpressreaseD4_Press-release.pdf> — “including Apple TV+, Hulu, Paramount+, Prime Video and YouTube.” (checked 2026-10-18)
  - [r5] <https://support.paramountplus.com/s/article/PI-Which-browsers-are-supported-for-Paramount?language=en_US> — “For optimal streaming on desktop, please use the latest available version of the supported browsers below” (checked 2026-10-18)

## Peacock

- **Best anywhere:** 4K/UHD [k1]; HDR: Dolby Vision confirmed by title labels; HDR10 and HDR10+ unknown [k2]. Where: Selected compatible 4K devices/apps; official help does not publish a complete 4K eligibility matrix. Mac/Windows app ceilings unknown [k1]
- **Mac browsers:** Chrome: unknown; supported browser [k3] · Safari: unknown; browser 4K/HDR not established [k3] · Firefox: unknown; supported browser [k3] · Edge: unknown; supported browser [k3]
- Premium or Premium Plus, eligible 4K title and specifically supported 4K device [k1].
- Notes: A supported browser is not evidence of a particular resolution. A title's 4K/Dolby Vision badge describes available content, not what a desktop browser receives. Orion: unknown.
- Sources:
  - [k1] <https://www.peacocktv.com/help/article/4k-uhd> — “4K Ultra HD to Premium and Premium Plus subscribers on some supported devices” (checked 2026-10-18)
  - [k2] <https://www.peacocktv.com/stream-movies/the-killer> — “4K UHD HDR … Dolby Vision” (checked 2026-10-18)
  - [k3] <https://www.peacocktv.com/help/article/what-Devices-and-platforms-are-supported-by-peacock> — “Chrome 125+ (Windows/Mac) … Firefox 127+ (Windows/Mac) … MS Edge 125+ (Windows/Mac) … Safari 17.3+ (Mac)” (checked 2026-10-18)

## AMC+

- **Best anywhere:** unknown; HDR: Dolby Vision/HDR10/HDR10+: unknown. Where: TV/streaming-device apps exist; their maximum quality is undocumented in the official material located. Desktop app ceilings unknown [c1]
- **Mac browsers:** Chrome: unknown · Safari: unknown; 4K/HDR unverified · Firefox: unknown · Edge: unknown
- Top-quality plan/hardware gates: unknown.
- Notes: Shudder, separately: current official help says most content is 1080p; it does not establish browser/app ceilings or HDR availability. Do not copy that claim to AMC+. Older blanket Shudder=720p descriptions conflict with current official wording. AMC+ through partner channels is another playback environment. Orion: unknown.
- Sources:
  - [c1] <https://support.amcplus.com/kb/guide/en/what-devices-does-amc-support-mJTWlwqXSj/Steps/3678016> — “AMC+ can be accessed at amcplus.com using a web browser, and on our apps” (checked 2026-10-18)
  - [c2] <https://support.shudder.com/kb/guide/en/what-resolutions-are-titles-available-in-pX6GSvGfXm/Steps/3638255> — “Most of our content is available in 1080p (HD)” (checked 2026-10-18)
  - [c3] <https://support.amcplus.com/kb/guide/en/with-an-amc-subscription-can-i-access-shudder-and-sundance-now-on-their-own-websites-or-apps-IdZRKHAHg5/Steps/3735053> — “Your AMC+ sign-in credentials will not work on the individual site and apps for Shudder” (checked 2026-10-18)

## YouTube (not in the HUD: its own Stats for nerds covers it)

- **Best anywhere:** Ordinary videos: 8K/4320p supported platform-wide; Movies & TV purchases/rentals: 4K [y1,y2]; HDR: Ordinary videos: HDR with PQ/HLG; HDR10+ confirmed by format association; Dolby Vision delivery unknown. Paid-title HDR mapping unknown [y3,y6]. Where: 8K app/device eligibility not comprehensively documented. Purchased 4K titles: eligible Smart TV/Android TV YouTube apps or Chromecast Ultra [y2]
- **Mac browsers:** Chrome: Ordinary-video absolute ceiling unknown; paid Movies & TV: SD, numeric ceiling unspecified [y4,y5] · Safari: Ordinary videos: 4K HDR confirmed, absolute maximum unknown; paid Movies & TV: HD only, exact cap unspecified [y4,y7] · Firefox: Ordinary-video absolute ceiling unknown; paid Movies & TV: SD, numeric ceiling unspecified [y4,y5] · Edge: Ordinary-video absolute ceiling unknown; paid Movies & TV: SD, numeric ceiling unspecified [y4,y5]
- 4K ordinary videos require a browser/device supporting the offered high-resolution codec; YouTube specifically documents VP9 [y9].
- Paid 4K titles require an eligible playback device, UHD title entitlement and at least 15 Mbps [y2].
- HDR requires compatible content and HDR playback hardware [y3].
- Notes: Never apply Movies & TV DRM limits to ordinary uploads. Official pages do not establish a current per-browser 8K matrix. y4's HD restriction is within Movies and TV requirements. y8 is old but directly documents desktop HDR; it does not certify current Mac Chrome HDR. Orion: unknown.
- Sources:
  - [y1] <https://support.google.com/youtube/answer/6375112?hl=en> — “4320p (8k): 7680x4320” (checked 2026-10-18)
  - [y2] <https://support.google.com/youtube/answer/3306741?hl=en> — “purchased 4K UHD quality videos using the YouTube app on eligible Smart TVs and Android TVs, or with a Chromecast Ultra” (checked 2026-10-18)
  - [y3] <https://support.google.com/youtube/answer/7126552?hl=en> — “Viewers can watch HDR videos on compatible mobile devices and HDR TVs … PQ or HLG” (checked 2026-10-18)
  - [y4] <https://support.google.com/youtube/answer/78358?hl=en> — “Playback in HD is unavailable for streaming on a browser, except for Safari for HD streaming only.” (checked 2026-10-18)
  - [y5] <https://support.google.com/youtube/answer/6322658?hl=en> — “Google Chrome (all operating systems) … MS Edge … Safari … Firefox” (checked 2026-10-18)
  - [y6] <https://hdr10plus.org/wp-content/uploads/2025/01/HDR10CESpressreaseD4_Press-release.pdf> — “Prime Video and YouTube.” (checked 2026-10-18)
  - [y7] <https://www.apple.com/safari/> — “4K HDR video playback for YouTube” (checked 2026-10-18)
  - [y8] <https://developer.chrome.com/blog/media-updates-in-chrome-63-64/> — “Chrome additionally supports HDR video playback when Windows 10 is in HDR mode.” (checked 2026-10-18)
  - [y9] <https://support.google.com/youtube/answer/1722171?hl=en> — “To view new 4K uploads in 4K, use a browser or device that supports VP9.” (checked 2026-10-18)

## Criterion Channel

- **Best anywhere:** unknown; HDR: Dolby Vision/HDR10/HDR10+: unknown. Where: Browser and TV/mobile apps documented; current maximum quality and desktop app ceilings not reliably verified [q1]
- **Mac browsers:** Chrome: unknown · Safari: unknown; current 4K/HDR support unverified · Firefox: unknown · Edge: unknown
- Current top-quality hardware/plan gates: unknown.
- Notes: q2 is a journalist's direct spokesperson interview from April 2019: too old to certify October 2026. Current official FAQ lacks resolution figures; linked support portal was inaccessible. Common 1080p claims were not independently reverified in accessible current authoritative material. A '4K restoration' is not a streaming-resolution claim. Orion: unknown.
- Sources:
  - [q1] <https://www.criterion.com/faq/channel> — “use a computer web browser to stream from criterionchannel.com, or use the Criterion Channel App” (checked 2026-10-18)
  - [q2] <https://hollywood-elsewhere.com/criterion-channel-report-card/> — “4K is not supported at the moment. We’ll see what the future brings.” (checked 2026-10-18)

## MUBI

- **Best anywhere:** 4K for selected films [u1]; HDR: Dolby Vision/HDR10/HDR10+: unknown. Where: Exact 4K device/app mapping unknown. Official device list includes TV/streaming apps but does not establish their quality ceilings; Mac/Windows app ceilings unknown [u1,u2]
- **Mac browsers:** Chrome: unknown; supported [u3] · Safari: unknown; supported, but browser 4K/HDR unverified [u3] · Firefox: unknown; supported [u3] · Edge: unknown; supported [u3]
- Qualifying film, device and internet connection; numeric 4K bandwidth/hardware gates unknown [u1].
- Current supported browser/OS and functional Widevine where used [u3].
- Notes: Quality FAQ updated May 13, 2026. Older MUBI=1080p-only summaries are superseded service-wide, but the new 4K statement does not prove any particular browser receives 4K. Orion: unknown.
- Sources:
  - [u1] <https://help.mubi.com/article/26-are-movies-available-to-watch-in-hd> — “we make our films available in HD and 4K when we can” (checked 2026-10-18)
  - [u2] <https://mubi.com/en/devices> — “Apple TV HD / 4K” (checked 2026-10-18)
  - [u3] <https://help.mubi.com/article/1135-updating-browsers-and-widevine-cdm> — “MUBI supports the newest versions of Chrome, Firefox, Safari and Edge on Mac & PC.” (checked 2026-10-18)
