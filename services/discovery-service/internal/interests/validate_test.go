package interests

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestNormalizeKeepsOneSpellingOfEachInterest(t *testing.T) {
	got, err := normalize([]string{"  Music ", "music", "MUSIC", "", "   ", "Jazz"})
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	want := []string{"Music", "Jazz"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestNormalizeRejectsARequestBeyondTheBound(t *testing.T) {
	if _, err := normalize(make([]string, MaxInterests+1)); err == nil {
		t.Fatal("normalize accepted more than MaxInterests interests")
	}
}

func TestNormalizeRejectsAnOverlongInterest(t *testing.T) {
	if _, err := normalize([]string{strings.Repeat("a", MaxInterestLength+1)}); err == nil {
		t.Fatalf("normalize accepted a %d character interest", MaxInterestLength+1)
	}
}

func TestNormalizeAcceptsTheExactBound(t *testing.T) {
	values := make([]string, 0, MaxInterests)
	for i := 0; i < MaxInterests; i++ {
		values = append(values, fmt.Sprintf("interest %d", i))
	}
	got, err := normalize(values)
	if err != nil {
		t.Fatalf("normalize at the bound: %v", err)
	}
	if len(got) != MaxInterests {
		t.Fatalf("got %d interests, want %d", len(got), MaxInterests)
	}
}
