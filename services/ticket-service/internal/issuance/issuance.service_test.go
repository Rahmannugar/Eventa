package issuance

import "testing"

func TestPaidOrderRejectsInvalidQuantity(t *testing.T) {
	if err := validateQuantity(0); err == nil {
		t.Fatal("expected invalid quantity")
	}
}
