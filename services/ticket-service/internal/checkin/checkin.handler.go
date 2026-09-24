package checkin

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

type requestBody struct {
	QRToken     string `json:"qrToken"`
	EventID     string `json:"eventId"`
	CheckedInBy string `json:"checkedInBy"`
}

// CheckIn handles the internal scanner command used by the authenticated Gateway.
func (h *Handler) CheckIn(c *gin.Context) {
	var body requestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	result, err := h.service.CheckIn(c.Request.Context(), Request(body))
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrTicketNotFound), errors.Is(err, ErrEventMismatch):
			c.Status(http.StatusBadRequest)
		case errors.Is(err, ErrTicketRevoked):
			c.Status(http.StatusConflict)
		default:
			c.Status(http.StatusInternalServerError)
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticketId": result.TicketID, "eventId": result.EventID, "checkedInAt": result.CheckedInAt, "alreadyCheckedIn": result.AlreadyCheckedIn})
}
