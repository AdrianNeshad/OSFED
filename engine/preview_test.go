package main

import (
	"image"
	"image/color"
	"testing"
)

func TestScaleMax(t *testing.T) {
	// A 1000x400 image scaled to max=256 should become 256x102 (longest side capped).
	src := image.NewRGBA(image.Rect(0, 0, 1000, 400))
	for y := 0; y < 400; y++ {
		for x := 0; x < 1000; x++ {
			src.Set(x, y, color.RGBA{uint8(x % 256), uint8(y % 256), 128, 255})
		}
	}
	out := scaleMax(src, 256)
	if out.Bounds().Dx() != 256 {
		t.Fatalf("width = %d, want 256", out.Bounds().Dx())
	}
	if h := out.Bounds().Dy(); h < 95 || h > 110 {
		t.Fatalf("height = %d, want ~102", h)
	}

	// Already-small images are returned unchanged.
	small := image.NewRGBA(image.Rect(0, 0, 100, 80))
	if scaleMax(small, 256) != image.Image(small) {
		t.Fatal("small image should be returned unchanged")
	}
}
