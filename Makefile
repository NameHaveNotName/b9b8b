.PHONY: build run dev stop logs

build:
	docker-compose build

run:
	docker-compose up -d
	@echo "服务已启动，访问 http://localhost:3000"

dev:
	docker-compose -f docker-compose.dev.yml up

stop:
	docker-compose down

logs:
	docker-compose logs -f app
