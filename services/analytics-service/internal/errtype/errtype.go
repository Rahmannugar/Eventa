// Package errtype names an error the way the TypeScript telemetry read
// `error.name`, so `error_type` stays stable across the port.
package errtype

import (
	"errors"
	"reflect"
)

// Of returns the name of an error. Errors that name themselves win; anything
// else falls back to its Go type.
func Of(err error) string {
	if err == nil {
		return "UnknownError"
	}
	var named interface{ Name() string }
	if errors.As(err, &named) {
		return named.Name()
	}
	errType := reflect.TypeOf(err)
	if errType == nil {
		return "UnknownError"
	}
	return errType.String()
}
