# Synthetic test video

`test-sub.flv` (320 × 180) and `test-main.flv` (640 × 360) are generated H.264 color/test patterns, not camera footage. Each is three seconds at 10 frames per second. They are looped by the local TCP test source with monotonically increasing timestamps and passed through the real go2rtc MSE pipeline.

They were created with FFmpeg's built-in `testsrc2` generator and libx264, using no third-party media. FFmpeg is **not** needed to run the app or play these files.

To regenerate, change the output filename/size for each clip:

```bash
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=10 -t 3 -c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -pix_fmt yuv420p -g 10 -keyint_min 10 -sc_threshold 0 -bf 0 -f flv test-sub.flv
```
