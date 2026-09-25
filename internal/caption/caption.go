// Package caption holds the types shared across the captioning pipeline.
package caption

import "time"

// Segment is one finalized caption line: the original text plus its
// translations, timed against the room's audio clock (seconds).
type Segment struct {
	ID   int    `json:"id"`
	Room string `json:"room"`
	// Talk numbers the talks given in the room, from 1, and TalkTitle
	// names the talk when the production team gave it a title.
	Talk      int       `json:"talk,omitempty"`
	TalkTitle string    `json:"talkTitle,omitempty"`
	At        time.Time `json:"at,omitzero"` // wall-clock time the line was transcribed
	T0        float64   `json:"t0"`
	T1        float64   `json:"t1"`
	Lang      string    `json:"lang"`
	Text      string    `json:"text"`
	// Translations maps a language code to the text in that language.
	Translations map[string]string `json:"translations,omitempty"`
	Error        string            `json:"error,omitempty"`
}

// In returns the segment text in lang, falling back to the original text
// when that translation is missing.
func (s Segment) In(lang string) string {
	if lang == s.Lang {
		return s.Text
	}
	if t := s.Translations[lang]; t != "" {
		return t
	}
	return s.Text
}
