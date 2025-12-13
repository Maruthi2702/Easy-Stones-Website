
import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useProducts } from '../context/ProductContext';
import { getLocalImagePath } from '../utils/imagePath';
import './HeroCarousel.css';

const HeroCarousel = () => {
    const { products, loading } = useProducts();

    // 1. Explicit Slider Products
    const sliderProducts = products.filter(p => p.showInSlider);

    // Show loading skeleton if fetching and no products
    if (loading && products.length === 0) {
        return (
            <section className="hero-carousel skeleton-loading">
                <div className="carousel-slide active">
                    <div className="slide-image-wrapper bg-gray-200 animate-pulse">
                        <div className="slide-overlay" />
                    </div>
                </div>
            </section>
        );
    }

    const defaultSlides = [
        {
            image: "Calacatta_Bella.jpg",
            title: "Moda Quartz",
            subtitle: "Timeless Elegance for Modern Living"
        },
        {
            image: "Statuario_Fantasia.jpg",
            title: "Moda Quartz",
            subtitle: "Engineered for Perfection"
        }
    ];

    // Determine final slides with fallback logic
    let displayProducts = [];
    if (sliderProducts.length > 0) {
        displayProducts = sliderProducts;
    } else if (products.length > 0) {
        // Fallback: Use first 5 products if no explicit slider items
        displayProducts = products.slice(0, 5);
    }

    // Map to slide format or use defaults if completely empty
    const slides = displayProducts.length > 0
        ? displayProducts.map(p => ({
            image: p.image,
            title: p.category,
            subtitle: p.name,
            id: p.id
        }))
        : defaultSlides;

    const [current, setCurrent] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrent((prev) => (prev + 1) % slides.length);
        }, 5000);
        return () => clearInterval(timer);
    }, [slides.length]);

    const nextSlide = () => setCurrent((prev) => (prev + 1) % slides.length);
    const prevSlide = () => setCurrent((prev) => (prev - 1 + slides.length) % slides.length);

    return (
        <section className="hero-carousel">
            {slides.map((slide, index) => (
                <div
                    key={index}
                    className={`carousel-slide ${index === current ? 'active' : ''}`}
                >
                    <div className="slide-image-wrapper">
                        <img
                            src={getLocalImagePath(slide.image)}
                            alt={slide.title}
                            className="slide-image"
                        />
                        <div className="slide-overlay" />
                    </div>
                    <div className="slide-content container">
                        <h1 className="slide-title">
                            <span className="slide-title-main">{slide.title}</span>
                        </h1>
                        <p className="slide-subtitle">{slide.subtitle}</p>

                    </div>
                </div>
            ))}

            <div className="carousel-controls">
                <button className="control-btn prev" onClick={prevSlide} aria-label="Previous slide">
                    <ChevronLeft size={24} />
                </button>
                <button className="control-btn next" onClick={nextSlide} aria-label="Next slide">
                    <ChevronRight size={24} />
                </button>
            </div>

            <div className="carousel-indicators">
                {slides.map((_, index) => (
                    <button
                        key={index}
                        className={`indicator ${index === current ? 'active' : ''}`}
                        onClick={() => setCurrent(index)}
                        aria-label={`Go to slide ${index + 1}`}
                    />
                ))}
            </div>
        </section>
    );
};

export default HeroCarousel;
