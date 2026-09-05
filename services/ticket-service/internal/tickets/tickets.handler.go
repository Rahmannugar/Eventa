package tickets

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type Handler struct{ reader *TicketReader }

func NewHandler(reader *TicketReader) *Handler { return &Handler{reader: reader} }

// List handles the internal attendee-ticket read used by the API Gateway.
func (h *Handler) List(c *gin.Context) {
	limit := int32(50)
	if value := c.Query("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			c.Status(http.StatusBadRequest)
			return
		}
		limit = int32(parsed)
	}
	var before *Cursor
	if value := c.Query("before"); value != "" {
		parsed, err := DecodeCursor(value)
		if err != nil {
			c.Status(http.StatusBadRequest)
			return
		}
		before = &parsed
	}
	tickets, err := h.reader.ListAttendeeTickets(c.Request.Context(), ID(c.Param("attendeeId")), before, limit)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			c.Status(http.StatusBadRequest)
		} else {
			c.Status(http.StatusInternalServerError)
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"tickets": tickets, "nextBefore": nextCursor(tickets, limit)})
}

func nextCursor(tickets []IssuedTicket, limit int32) string {
	if int32(len(tickets)) < limit || len(tickets) == 0 {
		return ""
	}
	cursor, err := EncodeCursor(Cursor{IssuedAt: tickets[len(tickets)-1].IssuedAt, ID: tickets[len(tickets)-1].ID})
	if err != nil {
		return ""
	}
	return cursor
}
