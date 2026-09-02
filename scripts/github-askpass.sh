#!/bin/sh
case "$1" in
  *Username*) printf '%s' 'gearline-lab' ;;
  *) /opt/homebrew/bin/gh auth token ;;
esac
