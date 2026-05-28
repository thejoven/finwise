// Package nats wraps NATS JetStream connection setup.
// M1 only opens a connection; subjects + consumers land in M2.
package nats

import (
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
)

type Client struct {
	Conn *nats.Conn
	JS   nats.JetStreamContext
}

func Connect(url string) (*Client, error) {
	nc, err := nats.Connect(url,
		nats.Name("flashfi-server"),
		nats.Timeout(5*time.Second),
		nats.ReconnectWait(2*time.Second),
		nats.MaxReconnects(-1),
	)
	if err != nil {
		return nil, fmt.Errorf("nats connect: %w", err)
	}

	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("jetstream context: %w", err)
	}

	return &Client{Conn: nc, JS: js}, nil
}

func (c *Client) Close() {
	if c.Conn != nil {
		c.Conn.Close()
	}
}
