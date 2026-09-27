// Package validate is a faithful port of the validator.js checks the
// TypeScript service obtained through class-validator. Recipient addresses are
// compared with the same defaults, so a job accepted by the old service is
// accepted here and vice versa.
package validate

import (
	"regexp"
)

// emailUserUTF8Part is validator.js `emailUserUtf8Part`: the allowed local-part
// characters when the local part is not quoted.
var emailUserUTF8Part = regexp.MustCompile(`(?i)^[a-z\d!#$%&'*+\-/=?^_` + "`" + `{|}~` +
	`\x{00A1}-\x{D7FF}\x{F900}-\x{FDCF}\x{FDF0}-\x{FFEF}]+$`)

// quotedEmailUserUTF8 is validator.js `quotedEmailUserUtf8`: a local part
// wrapped in double quotes, with the escaped and printable characters it allows.
var quotedEmailUserUTF8 = regexp.MustCompile(`(?i)^([\x{0020}\x{0009}\x{000A}\x{000B}\x{000C}\x{000D}\x{00A0}` +
	`\x{0001}-\x{0008}\x{000E}-\x{001F}\x{007F}\x{0021}\x{0023}-\x{005B}\x{005D}-\x{007E}` +
	`\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}` +
	`\x{00A0}-\x{D7FF}\x{F900}-\x{FDCF}\x{FDF0}-\x{FFEF}]` +
	`|(\\[\x{0001}-\x{0009}\x{000B}\x{000C}\x{000D}-\x{007F}` +
	`\x{00A0}-\x{D7FF}\x{F900}-\x{FDCF}\x{FDF0}-\x{FFEF}]))*$`)

var (
	tldPattern     = regexp.MustCompile(`(?i)^([a-z\x{00A1}-\x{00A8}\x{00AA}-\x{D7FF}\x{F900}-\x{FDCF}\x{FDF0}-\x{FFEF}]{2,}|xn[a-z0-9-]{2,})$`)
	partPattern    = regexp.MustCompile(`(?i)^[a-z_\x{00A1}-\x{FFFF}0-9-]+$`)
	numericTLD     = regexp.MustCompile(`^\d+$`)
	fullwidthChars = regexp.MustCompile(`[\x{FF01}-\x{FF5E}]`)
	edgeHyphen     = regexp.MustCompile(`(^-|-$)`)
	spaceInTLD     = regexp.MustCompile(`\s`)
)

const (
	maxEmailLength    = 254
	maxUserByteSize   = 64
	maxDomainByteSize = 254
)

// IsEmail reports whether str is a valid address under the validator.js
// defaults class-validator uses: require_tld, no display name, UTF-8 local
// part, no IP domain, and the implicit length limits.
func IsEmail(str string) bool {
	if utf16Length(str) > maxEmailLength {
		return false
	}

	at := lastIndexByte(str, '@')
	if at < 0 {
		return false
	}
	domain := str[at+1:]
	user := str[:at]

	if utf8Len(user) > maxUserByteSize || utf8Len(domain) > maxDomainByteSize {
		return false
	}
	if !isFQDN(domain) {
		return false
	}

	if len(user) > 0 && user[0] == '"' && user[len(user)-1] == '"' {
		return quotedEmailUserUTF8.MatchString(user[1 : len(user)-1])
	}

	for _, segment := range splitDot(user) {
		if !emailUserUTF8Part.MatchString(segment) {
			return false
		}
	}
	return true
}

func isFQDN(domain string) bool {
	parts := splitDot(domain)
	if len(parts) < 2 {
		return false
	}
	tld := parts[len(parts)-1]
	if !tldPattern.MatchString(tld) {
		return false
	}
	if spaceInTLD.MatchString(tld) {
		return false
	}
	if numericTLD.MatchString(tld) {
		return false
	}

	for _, part := range parts {
		if utf16Length(part) > 63 {
			return false
		}
		if !partPattern.MatchString(part) {
			return false
		}
		if fullwidthChars.MatchString(part) {
			return false
		}
		if edgeHyphen.MatchString(part) {
			return false
		}
		if containsByte(part, '_') {
			return false
		}
	}
	return true
}

func splitDot(value string) []string {
	start := 0
	var parts []string
	for i := 0; i < len(value); i++ {
		if value[i] == '.' {
			parts = append(parts, value[start:i])
			start = i + 1
		}
	}
	return append(parts, value[start:])
}

func lastIndexByte(value string, target byte) int {
	for i := len(value) - 1; i >= 0; i-- {
		if value[i] == target {
			return i
		}
	}
	return -1
}

func containsByte(value string, target byte) bool {
	for i := 0; i < len(value); i++ {
		if value[i] == target {
			return true
		}
	}
	return false
}

// utf8Len measures encoded bytes, matching validator.js `isByteLength`, which
// counts the %XX escapes encodeURI produces for non-ASCII characters.
func utf8Len(value string) int { return len(value) }

// utf16Length matches JavaScript's String.length, which counts UTF-16 code
// units rather than runes or bytes.
func utf16Length(value string) int {
	units := 0
	for _, r := range value {
		if r > 0xFFFF {
			units += 2
		} else {
			units++
		}
	}
	return units
}
