package cloud

import (
	"regexp"
	"time"
	_ "time/tzdata"
)

var pageIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func validPageMetadata(p map[string]any) bool {
	id, ok := p["id"].(string)
	if !ok || !pageIDPattern.MatchString(id) {
		return false
	}
	title, ok := p["title"].(string)
	if !ok || len(title) > 4096 {
		return false
	}
	if v := p["parentId"]; v != nil {
		parent, ok := v.(string)
		if !ok || !pageIDPattern.MatchString(parent) {
			return false
		}
	}
	for _, key := range []string{"icon", "cover", "titleDate", "titleDateSuffix"} {
		if value, exists := p[key]; exists && value != nil {
			v, ok := value.(string)
			if !ok || len(v) > 4096 {
				return false
			}
		}
	}
	for _, key := range []string{"favorite", "fullWidth"} {
		if value, exists := p[key]; exists && value != nil {
			if _, ok := value.(bool); !ok {
				return false
			}
		}
	}
	if value, exists := p["coverPosition"]; exists && value != nil {
		if _, ok := value.(float64); !ok {
			return false
		}
	}
	if value, exists := p["titleDateDisplay"]; exists && value != nil {
		display, ok := value.(map[string]any)
		if !ok {
			return false
		}
		for _, key := range []string{"dateFormat", "timeFormat", "timeZone", "defaultReminder"} {
			if v, exists := display[key]; exists && v != nil {
				str, ok := v.(string)
				if !ok || len(str) > 128 {
					return false
				}
			}
		}
	}
	if value, ok := p["titleDateDisplay"].(map[string]any); ok {
		if zone, ok := value["timeZone"].(string); ok {
			if _, e := time.LoadLocation(zone); e != nil || zone == "" || zone == "Local" {
				return false
			}
		}
	}
	return true
}

// A linear traversal avoids quadratic work for deeply nested hostile indexes.
func validParents(parents map[string]string) bool {
	state := make(map[string]uint8, len(parents))
	for id, parent := range parents {
		if parent != "" {
			if _, ok := parents[parent]; !ok {
				return false
			}
		}
		if state[id] == 2 {
			continue
		}
		stack := []string{}
		current := id
		for current != "" && state[current] != 2 {
			if state[current] == 1 {
				return false
			}
			state[current] = 1
			stack = append(stack, current)
			current = parents[current]
		}
		for _, seen := range stack {
			state[seen] = 2
		}
	}
	return true
}
