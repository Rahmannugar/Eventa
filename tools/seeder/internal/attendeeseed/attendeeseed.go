// Package attendeeseed generates the seeded attendee set: accounts Identity
// accepts for login, and the interest rows Discovery owns for those accounts.
// Like the events, every row derives from the seed and the generator index, so
// a rerun over a range addresses the same accounts instead of duplicating them.
package attendeeseed

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"

	"github.com/eventa/tools/seeder/internal/eventseed"
)

// Password parameters must match Identity's Argon2PasswordHasher exactly
// (argon2id, 64 MiB, three passes, four lanes, 32-byte tag, 16-byte salt), or
// a seeded account can never log in.
const (
	passwordTime    uint32 = 3
	passwordMemory  uint32 = 65_536
	passwordThreads uint8  = 4
	passwordKeyLen  uint32 = 32
	passwordSaltLen        = 16
)

const passwordAlgorithm = "$argon2id$v=19"

// Domain is the mail domain every seeded account carries.
const Domain = "eventa.com"

// Attendee is one seeded account together with the interest row Discovery
// keeps beside it.
type Attendee struct {
	ID              uuid.UUID
	Email           string
	Username        string
	PasswordHash    string
	EmailVerifiedAt time.Time
	Interests       []string
}

// Name returns the email and username one generator index maps to. Names come
// from the index alone, so every index in [0, MaxRange) has its own pair and a
// batch can never trip Identity's unique email or username index.
func Name(index int) (email, username string) {
	if index < 0 || index >= MaxRange {
		panic(fmt.Sprintf("attendeeseed: index %d falls outside the %d-name space", index, MaxRange))
	}
	first := firstNames[index%len(firstNames)]
	last := lastNames[(index/len(firstNames))%len(lastNames)]
	return fmt.Sprintf("%s.%s@%s", first, last, Domain), fmt.Sprintf("%s_%s", first, last)
}

// Generate returns the attendee for one generator index. The same seed,
// index, instant, and password always produce the same account, so rerunning
// a range inserts nothing new.
func Generate(seed int64, index int, now time.Time, password string) Attendee {
	email, username := Name(index)

	h := sha256.Sum256([]byte(fmt.Sprintf("eventa/seeder/v1/%d/%d/attendee", seed, index)))
	rng := rand.New(rand.NewPCG(
		binary.LittleEndian.Uint64(h[0:8]),
		binary.LittleEndian.Uint64(h[8:16]),
	))

	salt := sha256.Sum256([]byte(fmt.Sprintf("eventa/seeder/v1/%d/%d/attendee-password", seed, index)))
	verified := now.UTC().Truncate(time.Second)

	return Attendee{
		ID:              deriveID(seed, index, "attendee"),
		Email:           email,
		Username:        username,
		PasswordHash:    hashPassword(password, salt[:passwordSaltLen]),
		EmailVerifiedAt: verified,
		Interests:       interests(rng),
	}
}

// VerifyPassword reports whether an encoded hash matches a password. It
// parses the stored string rather than assuming it, so it also accepts a hash
// written by Identity itself.
func VerifyPassword(encoded, password string) bool {
	fields := strings.Split(encoded, "$")
	if len(fields) != 6 || fields[1] != "argon2id" || fields[2] != "v=19" {
		return false
	}

	var memory, passes uint32
	var lanes uint8
	if _, err := fmt.Sscanf(fields[3], "m=%d,t=%d,p=%d", &memory, &passes, &lanes); err != nil {
		return false
	}

	salt, err := base64.RawStdEncoding.DecodeString(fields[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(fields[5])
	if err != nil {
		return false
	}

	got := argon2.IDKey([]byte(password), salt, passes, memory, lanes, uint32(len(want)))
	return constantTimeEqual(got, want)
}

// hashPassword encodes a password the way the npm argon2 package Identity
// uses does: the PHC string with the standard, unpadded base64 it writes.
func hashPassword(password string, salt []byte) string {
	key := argon2.IDKey([]byte(password), salt, passwordTime, passwordMemory, passwordThreads, passwordKeyLen)
	return fmt.Sprintf("%s$m=%d,t=%d,p=%d$%s$%s",
		passwordAlgorithm,
		passwordMemory,
		passwordTime,
		passwordThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	)
}

// interests draws 1 to 6 distinct signals from the same vocabulary the
// seeded events are built from, so a seeded preference can actually match
// seeded content.
func interests(rng *rand.Rand) []string {
	count := rng.IntN(6) + 1
	chosen := make([]string, 0, count)
	seen := make(map[string]struct{}, count)
	for len(chosen) < count {
		candidate := eventseed.InterestPool[rng.IntN(len(eventseed.InterestPool))]
		if _, exists := seen[candidate]; exists {
			continue
		}
		seen[candidate] = struct{}{}
		chosen = append(chosen, candidate)
	}
	return chosen
}

// deriveID is a stable, version-5 shaped UUID for one generated row, built
// the same way the event generator builds its ids.
func deriveID(seed int64, index int, label string) uuid.UUID {
	sum := sha256.Sum256([]byte(fmt.Sprintf("eventa/seeder/v1/%d/%d/%s", seed, index, label)))
	var id uuid.UUID
	copy(id[:], sum[:16])
	id[6] = (id[6] & 0x0f) | 0x50
	id[8] = (id[8] & 0x3f) | 0x80
	return id
}

func constantTimeEqual(left, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	var difference byte
	for i := range left {
		difference |= left[i] ^ right[i]
	}
	return difference == 0
}

// MaxRange is the contiguous index range one seed can address: every index
// maps to one first/last pair, so a batch never repeats a name and cannot
// trip the unique email or username index. The CLI refuses larger ranges
// instead of silently producing duplicates.
var MaxRange = len(firstNames) * len(lastNames)

var (
	firstNames = []string{
		"ade", "ayo", "bola", "bimpe", "dara", "ejiro", "femi", "funmi",
		"gita", "gabriel", "hauwa", "hassan", "ife", "imade", "jide", "johnson",
		"kemi", "kola", "layo", "mina", "nkechi", "nnamdi", "olu", "oluwaseun",
		"precious", "queens", "rina", "sade", "sadiq", "tobi", "uche", "umeh",
		"victor", "wale", "yemi", "zainab", "chidi", "danjuma", "ebele", "kelechi",
	}
	lastNames = []string{
		"okafor", "balogun", "adeyemi", "nwosu", "eze", "mensah", "owusu", "kamau",
		"ndlovu", "mwangi", "otieno", "ugwu", "sekibo", "abubakar", "yusuf", "diallo",
		"okonkwo", "adesanya", "nwafor", "bello", "ogunleye", "afolayan", "chukwu", "obasanjo",
		"moyo", "chirwa", "tembo", "banda", "keita", "traore", "nkrumah", "gyasi",
		"asante", "boateng", "quartey", "mensimah", "doe", "kpankpanfo", "ezenwa", "udofia",
	}
)
